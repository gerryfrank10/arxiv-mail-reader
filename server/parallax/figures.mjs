// Parallax paper figure extraction.
//
// Given an arXiv id, produce a cached set of displayable figures for the
// TikTok-style feed:
//   1. Download the paper PDF from arxiv.org (rate-limited, disk-cached).
//   2. `pdfimages -list` on the first 8 pages; keep raster figures with sane
//      dimensions (skips icons, rules, logos). `pdfimages -png` extracts them.
//   3. Downscale/convert to JPEG with macOS `sips` (max 1400px, q80).
//   4. Fallback when a paper has no raster figures: `pdftoppm` render of page 1.
//   5. Fallback when even that fails (no PDF / withdrawal): status "failed";
//      the client renders a branded placeholder card.
//
// Everything is cached under server/parallax/figure-cache/<arxivId>/ so each
// paper is processed once. Extraction is lazy: the first meta request blocks
// (bounded), later ones read the cache.
//
// Dev-pilot tooling note: poppler + sips are macOS host tools; the prod
// Docker image does not ship them. Like the fixture itself, these routes are
// dev/pilot-only (gated by pilotFixtureEnabled).

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CACHE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'figure-cache');

const MAX_FIGURES = 6;
const PDF_PAGES_SCAN = 8;
const MIN_W = 160, MIN_H = 120;
const ARXIV_MIN_GAP_MS = 3500;   // be polite to arxiv.org
let lastDownload = 0;

function safeId(arxivId) {
  return String(arxivId).replace(/[^A-Za-z0-9./-]/g, '').slice(0, 40);
}

function paperDir(arxivId) {
  return path.join(CACHE_ROOT, safeId(arxivId));
}

async function downloadPdf(arxivId) {
  const dir = paperDir(arxivId);
  mkdirSync(dir, { recursive: true });
  const pdfPath = path.join(dir, 'paper.pdf');
  if (existsSync(pdfPath) && statSync(pdfPath).size > 10_000) return pdfPath;

  const gap = Date.now() - lastDownload;
  if (gap < ARXIV_MIN_GAP_MS) await new Promise(r => setTimeout(r, ARXIV_MIN_GAP_MS - gap));
  lastDownload = Date.now();

  const url = `https://arxiv.org/pdf/${safeId(arxivId)}`;
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'parallax-pilot/0.1 (research feed pilot)' } });
  if (!res.ok) throw new Error(`arXiv PDF fetch failed (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 10_000 || buf.subarray(0, 5).toString('latin1') !== '%PDF-') {
    throw new Error('arXiv returned something that is not a PDF');
  }
  await writeFile(pdfPath, buf);
  return pdfPath;
}

// Parse `pdfimages -list` output into candidate rows.
function parseImageList(listOutput) {
  const rows = [];
  for (const line of listOutput.split('\n').slice(2)) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 8) continue;
    const [page, , type, wRaw, hRaw] = cols;
    if (type !== 'image') continue;
    const w = Number(wRaw), h = Number(hRaw);
    if (!Number.isFinite(w) || !Number.isFinite(h)) continue;
    rows.push({ page: Number(page), w, h });
  }
  return rows;
}

function isLikelyFigure({ w, h }) {
  if (w < MIN_W || h < MIN_H) return false;             // bullets, markers
  if (w * h > 20_000_000) return false;                 // absurd scans
  if (w / h > 12 || h / w > 12) return false;            // hairlines / strips
  return true;
}

async function sipsToJpeg(src, dest) {
  await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '80', '-Z', '1400', src, '--out', dest]);
}

async function extractFigures(arxivId) {
  const dir = paperDir(arxivId);
  const pdfPath = await downloadPdf(arxivId);
  const rawDir = path.join(dir, 'raw');
  mkdirSync(rawDir, { recursive: true });

  const { stdout: listOut } = await run('pdfimages', ['-f', '1', '-l', String(PDF_PAGES_SCAN), '-list', pdfPath]);
  const candidates = parseImageList(listOut);
  const keep = candidates.filter(isLikelyFigure).slice(0, MAX_FIGURES);

  const figures = [];
  if (keep.length > 0) {
    await run('pdfimages', ['-f', '1', '-l', String(PDF_PAGES_SCAN), '-png', pdfPath, path.join(rawDir, 'img')]);
    // Extraction order matches -list order across pages 1..N.
    for (let i = 0; i < keep.length; i++) {
      const src = path.join(rawDir, `img-${String(i).padStart(3, '0')}.png`);
      if (!existsSync(src)) continue;
      const dest = path.join(dir, `f${String(figures.length + 1).padStart(2, '0')}.jpg`);
      await sipsToJpeg(src, dest);
      figures.push({ file: path.basename(dest), kind: 'raster', width: keep[i].w, height: keep[i].h });
    }
  }

  // No usable raster figures -> render page 1 as the single visual.
  if (figures.length === 0) {
    await run('pdftoppm', ['-f', '1', '-l', '1', '-r', '110', '-png', pdfPath, path.join(rawDir, 'page')]);
    const pagePng = path.join(rawDir, 'page-1.png');
    if (!existsSync(pagePng)) throw new Error('No figures and page render failed.');
    const dest = path.join(dir, 'f01.jpg');
    await sipsToJpeg(pagePng, dest);
    figures.push({ file: 'f01.jpg', kind: 'first-page', width: 0, height: 0 });
  }

  await rm(rawDir, { recursive: true, force: true });
  return figures;
}

// Meta for one paper. Lazy-extracts on first call (bounded wait), then cached.
export async function getFiguresMeta(arxivId) {
  const dir = paperDir(arxivId);
  const metaPath = path.join(dir, 'meta.json');
  if (existsSync(metaPath)) {
    try { return JSON.parse(readFileSync(metaPath, 'utf8')); } catch { /* rebuild below */ }
  }

  try {
    const figures = await Promise.race([
      extractFigures(arxivId),
      new Promise((_res, rej) => setTimeout(() => rej(new Error('figure extraction timed out')), 90_000)),
    ]);
    const meta = {
      schemaVersion: 1,
      arxivId: safeId(arxivId),
      status: 'ready',
      figures,
      generatedAt: new Date().toISOString(),
    };
    mkdirSync(dir, { recursive: true });
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  } catch (cause) {
    const meta = {
      schemaVersion: 1,
      arxivId: safeId(arxivId),
      status: 'failed',
      figures: [],
      error: cause instanceof Error ? cause.message : 'extraction failed',
      generatedAt: new Date().toISOString(),
    };
    mkdirSync(dir, { recursive: true });
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
    return meta;
  }
}

export function figurePath(arxivId, file) {
  const safeFile = String(file).replace(/[^A-Za-z0-9._-]/g, '');
  const p = path.join(paperDir(arxivId), safeFile);
  if (!p.startsWith(CACHE_ROOT)) return null; // paranoia: no traversal
  return existsSync(p) ? p : null;
}

// Warm-up hook for prefetching without blocking a request forever.
export function warmFigures(arxivId) {
  void getFiguresMeta(arxivId).catch(() => {});
}
