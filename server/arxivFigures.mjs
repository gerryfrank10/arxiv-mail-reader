import { getDocumentProxy } from 'unpdf';

const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_FIGURES = 60;
const MAX_OUTPUT_EDGE = 1400;

export async function detectArxivPdfVersion(pdfBuffer, arxivId) {
  const document = await getDocumentProxy(new Uint8Array(pdfBuffer));
  try {
    const page = await document.getPage(1);
    const content = await page.getTextContent();
    const text = content.items.map(item => item.str).join(' ');
    const escaped = String(arxivId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/v\d+$/i, '');
    return text.match(new RegExp(`(?:arXiv:)?${escaped}(v\\d+)`, 'i'))?.[1] ?? null;
  } finally {
    await document.cleanup?.();
  }
}

function attributes(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(["'])(.*?)\2/g)) {
    result[match[1].toLowerCase()] = match[3];
  }
  return result;
}

/** Extract complete arXiv/LaTeXML figure blocks, retaining nested subfigures. */
export function extractArxivFigureSources(html, pageUrl) {
  const sources = [];
  const tags = /<(\/?)figure\b[^>]*>/gi;
  const stack = [];
  let active = null;
  let match;
  while ((match = tags.exec(html)) && sources.length < MAX_FIGURES) {
    const closing = match[1] === '/';
    if (!closing) {
      const attrs = attributes(match[0]);
      const classes = (attrs.class ?? '').split(/\s+/);
      const entry = { depth: stack.length + 1 };
      stack.push(entry);
      if (!active && classes.includes('ltx_figure')) {
        active = { start: match.index, depth: entry.depth };
      }
      continue;
    }

    const entry = stack.pop();
    if (active && entry && active.depth === entry.depth) {
      const block = html.slice(active.start, tags.lastIndex)
        .replace(/<figcaption\b[\s\S]*?<\/figcaption>/gi, '');
      const objects = [...block.matchAll(/<object\b[^>]*>/gi)]
        .map(tag => attributes(tag[0]).data).filter(Boolean);
      const images = [...block.matchAll(/<img\b[^>]*>/gi)]
        .map(tag => attributes(tag[0]).src).filter(Boolean);
      // Prefer vector objects, but use all images when a figure has PNG-only
      // subfigures. Identical URLs are never downloaded twice.
      const inlineSvg = [...block.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)].map(match => {
        let svg = match[0];
        if (!/\bxmlns\s*=/.test(svg)) svg = svg.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
        if (/\bxlink:/.test(svg) && !/\bxmlns:xlink\s*=/.test(svg)) {
          svg = svg.replace(/^<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
        }
        return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      });
      const candidates = objects.length > 0 ? [...objects, ...images] : [...images, ...inlineSvg];
      const urls = [...new Set(candidates.map(src => {
        if (src.startsWith('data:image/svg+xml;base64,')) return src;
        try { return new URL(src, pageUrl).href; } catch { return null; }
      }).filter(url => url && (/^https:\/\/(?:[^/]+\.)?arxiv\.org\//i.test(url) || url.startsWith('data:image/svg+xml;base64,'))))];
      if (urls.length > 0) sources.push(urls);
      active = null;
    }
  }
  return sources;
}

async function downloadImage(url, fetchImpl, headers) {
  if (url.startsWith('data:image/svg+xml;base64,')) {
    const buffer = Buffer.from(url.slice('data:image/svg+xml;base64,'.length), 'base64');
    if (buffer.length > MAX_ASSET_BYTES) throw new Error('Inline SVG exceeds the 20 MB limit');
    return buffer;
  }
  const response = await fetchImpl(url, {
    headers: { ...headers, Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/jpeg,*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Figure asset returned HTTP ${response.status}`);
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_ASSET_BYTES) throw new Error('Figure asset exceeds the 20 MB limit');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_ASSET_BYTES) throw new Error('Figure asset exceeds the 20 MB limit');
  return buffer;
}

async function decodeImage(buffer) {
  const { loadImage } = await import('@napi-rs/canvas');
  return loadImage(buffer);
}

async function encodeFigure(images) {
  const { createCanvas } = await import('@napi-rs/canvas');
  const columns = Math.min(images.length <= 3 ? images.length : 2, 3);
  const gap = 12;
  const cellWidth = Math.min(MAX_OUTPUT_EDGE, 1200) / columns;
  const rows = [];
  for (let i = 0; i < images.length; i += columns) rows.push(images.slice(i, i + columns));
  const rowHeights = rows.map(row => Math.max(...row.map(image => image.height * Math.min(1, cellWidth / image.width))));
  const width = Math.round(cellWidth * columns + gap * (columns - 1));
  const height = Math.round(rowHeights.reduce((sum, value) => sum + value, 0) + gap * (rows.length - 1));
  const canvas = createCanvas(Math.max(1, width), Math.max(1, height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  let y = 0;
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    for (let column = 0; column < row.length; column++) {
      const image = row[column];
      const scale = Math.min(1, cellWidth / image.width);
      const w = image.width * scale;
      const h = image.height * scale;
      context.drawImage(image, column * (cellWidth + gap) + (cellWidth - w) / 2, y, w, h);
    }
    y += rowHeights[rowIndex] + gap;
  }
  return { buffer: canvas.toBuffer('image/jpeg', 90), width: canvas.width, height: canvas.height };
}

/**
 * Use arXiv's original composed assets instead of guessing PDF crop bounds.
 * Returns null when HTML/assets are unavailable so the caller can use its PDF
 * fallback. Network and decoding errors are isolated to individual figures.
 */
export async function createArxivHtmlFigures(arxivId, {
  fetchImpl = fetch,
  headers = {},
} = {}) {
  const id = String(arxivId).trim().replace(/^arxiv:/i, '');
  if (!/^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(v\d+)?$/i.test(id)) return null;
  const pageUrl = `https://arxiv.org/html/${id}`;
  const response = await fetchImpl(pageUrl, {
    headers: { ...headers, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) return null;
  const html = await response.text();
  const groups = extractArxivFigureSources(html, response.url || pageUrl);
  if (groups.length === 0) return null;

  const figures = [];
  for (const urls of groups) {
    try {
      const images = [];
      for (const url of urls.slice(0, 12)) {
        images.push(await decodeImage(await downloadImage(url, fetchImpl, headers)));
      }
      if (images.length > 0) figures.push(await encodeFigure(images));
    } catch (error) {
      console.warn(`[figures] arXiv asset for ${id} needs PDF fallback: ${error.message}`);
      figures.push(null);
    }
  }
  return figures.some(Boolean) ? figures : null;
}
