import { extractImages, extractTextItems, getDocumentProxy, renderPageAsImage } from 'unpdf';

const MIN_IMAGE_AREA = 8_000;
const MAX_IMAGE_AREA = 40_000_000;
const PREVIEW_MAX_EDGE = 960;
const FIGURE_RENDER_SCALE = 2;
const FIGURE_CACHE_VERSION = 2;

export { FIGURE_CACHE_VERSION };

export function selectFirstPageImage(images) {
  return selectPaperFigureImages(images)
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))[0] ?? null;
}

/** Keep figure-sized raster images while excluding tiny logos and glyphs. */
export function selectPaperFigureImages(images) {
  return images
    .filter(img => img.width >= 80 && img.height >= 60
      && img.width * img.height >= MIN_IMAGE_AREA
      && img.width * img.height <= MAX_IMAGE_AREA
      && [1, 3, 4].includes(img.channels));
}

export async function encodeImageThumbnail(image) {
  if (!image) return null;
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const { createCanvas } = await import('@napi-rs/canvas');
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  const frame = context.createImageData(width, height);
  const src = image.data;
  const channels = image.channels;

  // Resample while converting grayscale/RGB/RGBA source data to RGBA.
  for (let y = 0; y < height; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x / scale));
      const si = (sy * image.width + sx) * channels;
      const di = (y * width + x) * 4;
      if (channels === 1) {
        frame.data[di] = frame.data[di + 1] = frame.data[di + 2] = src[si];
        frame.data[di + 3] = 255;
      } else {
        const alpha = channels === 4 ? src[si + 3] / 255 : 1;
        frame.data[di] = src[si] * alpha + 255 * (1 - alpha);
        frame.data[di + 1] = src[si + 1] * alpha + 255 * (1 - alpha);
        frame.data[di + 2] = src[si + 2] * alpha + 255 * (1 - alpha);
        frame.data[di + 3] = 255;
      }
    }
  }
  context.putImageData(frame, 0, 0);
  return canvas.toBuffer('image/jpeg', 82);
}

function isFigureCaption(item) {
  return /^(?:fig(?:ure)?\.?\s*)\d+(?:\s*\([a-z]\))?\s*[.:)\-–—]/i.test(String(item.str ?? '').trim());
}

function commonTextStart(items, fallback) {
  if (items.length === 0) return fallback;
  const counts = new Map();
  for (const item of items) {
    const key = Math.round(item.x / 2) * 2;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function captionColumn(items, caption, pageWidth) {
  const leftItems = items.filter(item => item.x >= 0 && item.x < pageWidth * 0.25);
  const leftText = leftItems.filter(item => item.width >= pageWidth * 0.15 && item.width <= pageWidth * 0.49);
  const left = commonTextStart(leftText.length ? leftText : leftItems, pageWidth * 0.09);
  const rightItems = items.filter(item => item.x >= pageWidth * 0.42 && item.x <= pageWidth * 0.68);
  const rightText = rightItems.filter(item => item.width >= pageWidth * 0.15 && item.width <= pageWidth * 0.49);
  const right = commonTextStart(rightText.length ? rightText : rightItems, pageWidth * 0.5);
  const twoColumns = leftText.length >= 8 && rightText.length >= 8 && right - left > pageWidth * 0.3;

  if (!twoColumns) {
    const rightEdge = Math.max(...items.map(item => item.x + item.width), pageWidth - left);
    return { x: left, width: Math.min(pageWidth - left, rightEdge - left) };
  }

  const columnWidth = Math.max(1, right - left - pageWidth * 0.03);
  const fullWidth = caption.width >= pageWidth * 0.44;
  if (fullWidth) {
    return { x: left, width: Math.min(pageWidth - left, pageWidth - left * 2) };
  }
  const x = caption.x < pageWidth * 0.42 ? left : right;
  return { x, width: Math.min(columnWidth, pageWidth - x) };
}

function findRenderedFigureBounds(context, sourceWidth, sourceHeight, cropX, cropWidth, captionTop, scale) {
  const x = Math.max(0, Math.floor(cropX * scale));
  const width = Math.max(1, Math.min(sourceWidth - x, Math.ceil(cropWidth * scale)));
  const captionY = Math.max(0, Math.min(sourceHeight, Math.floor(captionTop * scale)));
  const pixels = context.getImageData(x, 0, width, sourceHeight).data;
  const inkThreshold = 2;
  const isInkRow = (row) => {
    let ink = 0;
    const start = row * width * 4;
    const end = start + width * 4;
    for (let i = start; i < end; i += 4) {
      if (pixels[i] < 225 || pixels[i + 1] < 225 || pixels[i + 2] < 225) {
        if (++ink >= inkThreshold) return true;
      }
    }
    return false;
  };

  let bottomInk = -1;
  for (let y = captionY - 1; y >= 0; y--) {
    if (isInkRow(y)) { bottomInk = y; break; }
  }
  if (bottomInk < 0) return null;

  let blankRows = 0;
  const minBlankRows = Math.round(8 * scale);
  let top = 0;
  for (let y = bottomInk - 1; y >= 0; y--) {
    if (isInkRow(y)) {
      blankRows = 0;
      continue;
    }
    blankRows++;
    if (blankRows >= minBlankRows) {
      top = y + blankRows + 1;
      break;
    }
  }

  const padding = Math.round(5 * scale);
  const y = Math.max(0, top - padding);
  const bottom = Math.min(sourceHeight, bottomInk + padding + 1);
  return { x, y, width, height: bottom - y };
}

async function encodeRenderedCrop(image, crop) {
  const { createCanvas, loadImage } = await import('@napi-rs/canvas');
  const source = await loadImage(Buffer.from(image));
  const scale = Math.min(1, PREVIEW_MAX_EDGE / Math.max(crop.width, crop.height));
  const width = Math.max(1, Math.round(crop.width * scale));
  const height = Math.max(1, Math.round(crop.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext('2d').drawImage(source, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);
  return { buffer: canvas.toBuffer('image/jpeg', 88), width, height };
}

/** Render and crop captioned figures so vector art and multi-panel figures stay intact. */
export async function createPaperFigureThumbnails(pdfBuffer) {
  const document = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const figures = [];
  try {
    const { items: pages } = await extractTextItems(document);
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
      const items = pages[pageNumber - 1] ?? [];
      const captions = items.filter(isFigureCaption).sort((a, b) => b.y - a.y || a.x - b.x);
      if (captions.length === 0) continue;

      const page = await document.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const renderScale = Math.min(FIGURE_RENDER_SCALE, 1600 / viewport.width, 2000 / viewport.height);
      const rendered = await renderPageAsImage(document, pageNumber, {
        canvasImport: () => import('@napi-rs/canvas'),
        scale: renderScale,
      });
      const { createCanvas } = await import('@napi-rs/canvas');
      const { loadImage } = await import('@napi-rs/canvas');
      const pageImage = await loadImage(Buffer.from(rendered));
      const canvas = createCanvas(pageImage.width, pageImage.height);
      const context = canvas.getContext('2d');
      context.drawImage(pageImage, 0, 0);

      for (const caption of captions) {
        const region = captionColumn(items, caption, viewport.width);
        const captionTop = viewport.height - (caption.y + caption.height);
        const bounds = findRenderedFigureBounds(
          context,
          pageImage.width,
          pageImage.height,
          region.x,
          region.width,
          captionTop,
          pageImage.width / viewport.width,
        );
        if (!bounds || bounds.width < 40 || bounds.height < 30) continue;

        const encoded = await encodeRenderedCrop(rendered, bounds);
        figures.push({
          buffer: encoded.buffer,
          pageNumber,
          width: encoded.width,
          height: encoded.height,
        });
      }
    }
  } finally {
    await document.cleanup?.();
  }
  return figures;
}

/** Legacy first-page preview helper retained for callers outside the feed. */
export async function createFirstPageImageThumbnail(pdfBuffer) {
  const images = await extractImages(new Uint8Array(pdfBuffer), 1);
  return encodeImageThumbnail(selectFirstPageImage(images));
}
