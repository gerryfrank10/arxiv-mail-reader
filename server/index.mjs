import express from 'express';
import compression from 'compression';
import cors from 'cors';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { fileURLToPath } from 'url';
import { dirname, join, extname, basename } from 'path';
import { mkdirSync, unlinkSync, existsSync, statSync, writeFileSync, readFileSync } from 'fs';
import multer from 'multer';
import 'dotenv/config';
import { extractText as extractPdfTextRaw } from 'unpdf';
import { detectOrganization } from './organizations.mjs';
import {
  ARXIV_CATEGORY_RE as ARXIV_CAT_RE,
  extractArxivAbstract,
  extractArxivMetadata,
  parseArxivEntries as extractAllArxivMetadata,
} from './ingestion/sources/arxiv.mjs';
import { startIngestionWorker } from './ingestion/worker.mjs';
import { getSourcePlugin } from './ingestion/registry.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { db } from './db.mjs';
import { fetchSources, buildNewsQuery } from './sources.mjs';
import { createPaperFigureThumbnails, FIGURE_CACHE_VERSION } from './paperThumbnail.mjs';
import { createArxivHtmlFigures, detectArxivPdfVersion } from './arxivFigures.mjs';
import { isParallaxPublicRead, isParallaxPublicWrite, registerParallaxPublicApi } from './parallax/publicApi.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// Optional shared API token for /api/db/*. Identity normally comes from a
// login session; this legacy token is only an extra API fallback alongside
// x-user-email. Leave empty unless you need scripted access.
const AUTH_TOKEN = (process.env.APP_AUTH_TOKEN || '').trim();

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// Bumped to handle large migration payloads (hundreds of papers with
// full abstracts). The actual ceiling for a 1000-paper migration is
// around 8-10MB; 100mb gives us comfortable headroom for any direction.
// gzip responses — the paper-list payload is mostly text (abstracts) and
// compresses ~7x, which sharply cuts transfer time for large libraries.
app.use(compression());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
if (!isProd) {
  // In dev the Vite proxy handles CORS; in prod everything is same-origin
  app.use(cors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-user-email', 'x-s2-api-key'],
  }));
}

// Known IMAP presets
const PRESETS = {
  icloud:  { host: 'imap.mail.me.com',        port: 993 },
  gmail:   { host: 'imap.gmail.com',           port: 993 },
  outlook: { host: 'outlook.office365.com',    port: 993 },
  yahoo:   { host: 'imap.mail.yahoo.com',      port: 993 },
};

// ---------------------------- access control ----------------------------
// Every API route needs a logged-in session, except the ones used to sign in
// and to detect server health. /api/db routes run their own check in
// withUser(); everything else (arXiv/S2/IMAP/AI/source proxies) is gated here
// so anonymous visitors can't use this server as an open network proxy or
// burn its third-party API quota. Local development without a database has no
// accounts, so it stays open.
const PUBLIC_APIS = new Set(['/api/health', '/api/presets', '/api/db/status']);

app.use('/api', async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  const path = req.originalUrl.split('?')[0];
  if (PUBLIC_APIS.has(path) || isParallaxPublicRead(req) || isParallaxPublicWrite(req)) return next();
  if (path.startsWith('/api/auth/') || path.startsWith('/api/db/')) return next();
  if (!db.enabled) return next();
  try {
    const who = await resolveRequestUser(req);
    if (!who) return res.status(401).json({ error: 'Unauthorized — please sign in.' });
    next();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/presets', (_req, res) => res.json(PRESETS));
app.get('/api/health',  (_req, res) => res.json({ ok: true }));
registerParallaxPublicApi(app, {
  pilotFixtureEnabled: !isProd || process.env.PARALLAX_ENABLE_PILOT_FIXTURE === '1',
});

// Proxy arXiv API to avoid CORS issues in the browser
// Abstract fetch with arXiv -> Semantic Scholar fallback.
//
// We hit arXiv first (throttled per their policy). On rate-limit or any
// non-XML upstream, we try Semantic Scholar. Successful results are cached
// per-id for 24h; failures are negatively cached for 60s so the client
// can't accidentally hammer either upstream.
const abstractCache = new Map();   // id -> { abstract, source, ts }
const abstractNegCache = new Map(); // id -> { error, ts }
const ABSTRACT_TTL_MS    = 24 * 60 * 60 * 1000;
const ABSTRACT_NEG_TTL_MS = 60 * 1000;
const ARXIV_MIN_GAP_MS   = 3200;
const S2_MIN_GAP_MS      = 1100;
let lastArxivCall = 0;
let lastS2Call    = 0;
let arxivQueue = Promise.resolve();
let s2Queue    = Promise.resolve();

// arXiv's API politeness policy asks for a descriptive User-Agent with a
// contact — anonymous requests (esp. from cloud/container IPs) get 429'd much
// more aggressively. Send one on every arXiv call.
const ARXIV_HEADERS = {
  'User-Agent': `arxiv-mail-reader/1.0 (${process.env.OPENALEX_MAILTO ? `mailto:${process.env.OPENALEX_MAILTO}` : '+https://github.com/gerryfrank10/arxiv-mail-reader'})`,
};

// If a 429/503 response carries a Retry-After header, honour it (capped).
function retryAfterMs(r) {
  const ra = r.headers?.get?.('retry-after');
  if (!ra) return 0;
  const secs = Number(ra);
  return Number.isFinite(secs) ? Math.min(Math.max(secs, 0) * 1000, 60_000) : 0;
}

// Shared throttled arXiv GET with 429 retry/backoff. Serialised through
// arxivQueue so concurrent callers can't burst past the rate limit.
async function arxivFetchText(idList) {
  return arxivQueue = arxivQueue.then(async () => {
    const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(idList)}&max_results=100`;
    return arxivGetWithRetry(url);
  }).catch(err => { throw err; });
}

// Shared throttled+retrying arXiv GET. arXiv intermittently returns 429 (rate
// limit) and 503 (busy); both are transient. We respect a Retry-After header
// when present, otherwise use an escalating backoff, and always send the
// politeness User-Agent.
async function arxivGetWithRetry(url) {
  const BACKOFFS = [4000, 10000, 25000, 45000];
  const isRetryable = (status) => status === 429 || status >= 500;
  let lastErr;
  let pendingBackoff = 0;
  let lastStatus = null;
  let finalRetryAfterMs = 0;
  const retryDelaysMs = [];
  const retryDelaySources = [];
  let attempts = 0;
  for (let attempt = 0; attempt <= BACKOFFS.length; attempt++) {
    attempts = attempt + 1;
    if (attempt > 0) {
      const usedRetryAfter = pendingBackoff > 0;
      const backoff = pendingBackoff || BACKOFFS[attempt - 1];
      console.warn(`[arxiv] ${lastErr?.message ?? 'transient error'} — backing off ${backoff}ms (retry ${attempt}/${BACKOFFS.length})`);
      retryDelaysMs.push(backoff);
      retryDelaySources.push(usedRetryAfter ? 'Retry-After header' : 'configured exponential backoff');
      await new Promise(r => setTimeout(r, backoff));
      pendingBackoff = 0;
    }
    const wait = Math.max(0, ARXIV_MIN_GAP_MS - (Date.now() - lastArxivCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastArxivCall = Date.now();
    let r;
    try {
      r = await fetch(url, { headers: ARXIV_HEADERS });
    } catch (netErr) {
      // Network-level failure (DNS, connection reset) — also transient.
      lastErr = new Error(`arXiv request failed: ${netErr.message}`);
      continue;
    }
    const text = await r.text();
    if (r.status === 200) return text;
    lastStatus = r.status;
    lastErr = new Error(`arXiv ${r.status}`);
    if (!isRetryable(r.status)) break;
    // Prefer the server's Retry-After when it tells us how long to wait.
    pendingBackoff = retryAfterMs(r);
    finalRetryAfterMs = pendingBackoff;
  }
  const error = new Error(lastStatus ? `arXiv returned HTTP ${lastStatus}.` : (lastErr?.message ?? 'arXiv request failed.'));
  error.provider = 'arXiv';
  error.status = lastStatus;
  error.attempts = attempts;
  error.retryDelaysMs = retryDelaysMs;
  error.retryDelaySources = retryDelaySources;
  error.retryAfterMs = finalRetryAfterMs;
  throw error;
}

// Throttled arXiv *search* query (the search_query API, not id_list). Same
// retry/backoff + User-Agent as arxivFetchText. Returns one page of Atom XML.
async function arxivSearchFetch(searchQuery, start, perPage) {
  return arxivQueue = arxivQueue.then(async () => {
    const url = `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}`
      + `&start=${start}&max_results=${perPage}&sortBy=submittedDate&sortOrder=descending`;
    return arxivGetWithRetry(url);
  }).catch(err => { throw err; });
}

async function fetchFromArxiv(id) {
  // Single throttled call (no retry — we'd rather fall back to S2 quickly)
  return arxivQueue = arxivQueue.then(async () => {
    const wait = Math.max(0, ARXIV_MIN_GAP_MS - (Date.now() - lastArxivCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastArxivCall = Date.now();
    const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, { headers: ARXIV_HEADERS });
    const body = await r.text();
    if (r.status !== 200) throw new Error(`arXiv ${r.status}`);
    const abstract = extractArxivAbstract(body);
    if (!abstract) throw new Error('arXiv: no summary in feed');
    return abstract;
  }).catch(err => { throw err; });
}

async function fetchFromSemanticScholar(id) {
  return s2Queue = s2Queue.then(async () => {
    const wait = Math.max(0, S2_MIN_GAP_MS - (Date.now() - lastS2Call));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastS2Call = Date.now();
    const r = await fetch(`https://api.semanticscholar.org/graph/v1/paper/arXiv:${encodeURIComponent(id)}?fields=abstract`);
    if (r.status !== 200) throw new Error(`Semantic Scholar ${r.status}`);
    const data = await r.json();
    if (!data.abstract) throw new Error('Semantic Scholar: no abstract field');
    return String(data.abstract).replace(/\s+/g, ' ').trim();
  }).catch(err => { throw err; });
}

// Fetch full arXiv metadata (title, authors, abstract, categories, ...)
// Used by the in-app Import flow.
const metadataCache = new Map(); // id -> { meta, ts }
const METADATA_TTL_MS = 24 * 60 * 60 * 1000;

app.get('/api/arxiv-metadata', async (req, res) => {
  const rawId = String(req.query.id ?? '').trim().toLowerCase();
  if (!rawId) return res.status(400).json({ error: 'id is required' });
  const canon = rawId.replace(/v\d+$/i, '');  // versionless, for messages/fallback

  const cached = metadataCache.get(rawId);    // cache key includes the version
  if (cached && Date.now() - cached.ts < METADATA_TTL_MS) {
    return res.json(cached.meta);
  }
  try {
    const body = await arxivFetchText(rawId);  // query the exact version when given
    const meta = extractArxivMetadata(body, canon);
    if (!meta) {
      return res.status(404).json({ error: `No entry for arXiv:${rawId} — check the id` });
    }
    metadataCache.set(rawId, { meta, ts: Date.now() });
    res.json(meta);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch from arXiv: ${err.message}` });
  }
});

// Valid arXiv id forms: new "2401.12345" (+ optional vN, already stripped)
// or old-style "cs/0610001". arXiv 400s the WHOLE batch if any id is
// malformed, so we filter junk out up front and report it per-id.
const ARXIV_ID_RE = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})$/i;

// Batch metadata: one arXiv call for up to 50 ids. This is what the Import
// flow should use — it turns "20 papers = 20 rate-limited requests" into a
// single request. ?ids=2401.0001,1706.03762,...
app.get('/api/arxiv-metadata-batch', async (req, res) => {
  const raw = String(req.query.ids ?? '').trim();
  if (!raw) return res.status(400).json({ error: 'ids is required (comma-separated)' });
  // Keep any version suffix (vN) the caller passed — we query arXiv for that
  // exact version so the abstract matches the version the user imported.
  const requested = [...new Set(
    raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  )].slice(0, 50);
  if (requested.length === 0) return res.json({ results: {}, errors: {} });

  const canonical = (id) => id.replace(/v\d+$/i, '');
  const results = {};   // keyed by canonical id (versionless), value = requested version's meta
  const errors  = {};

  // Serve cached ids without hitting arXiv; reject malformed ids up front
  // so they don't 400 the whole upstream query.
  const toFetch = [];
  for (const id of requested) {
    const canon = canonical(id);
    if (!ARXIV_ID_RE.test(canon)) { errors[canon] = 'not a valid arXiv id'; continue; }
    const c = metadataCache.get(id);   // cache key includes the version
    if (c && Date.now() - c.ts < METADATA_TTL_MS) results[canon] = c.meta;
    else toFetch.push(id);
  }

  if (toFetch.length > 0) {
    try {
      const body = await arxivFetchText(toFetch.join(','));
      const metas = extractAllArxivMetadata(body);
      // arXiv strips the version from the returned <id>, so index by canonical.
      const byArxiv = new Map(metas.map(m => [m.arxivId, m]));
      for (const id of toFetch) {
        const canon = canonical(id);
        const meta = byArxiv.get(canon);
        if (meta) {
          metadataCache.set(id, { meta, ts: Date.now() });
          results[canon] = meta;
        } else {
          errors[canon] = 'no entry returned by arXiv (check the id)';
        }
      }
    } catch (err) {
      // Whole-batch failure (e.g. 429 after retries) — report per-id so the
      // client can show which ones still need retrying.
      for (const id of toFetch) errors[canonical(id)] = err.message;
    }
  }

  res.json({ results, errors });
});

// Build an arXiv search_query from a mode + value (+ optional date window).
function buildArxivSearchQuery({ mode, value, from, to }) {
  const v = String(value).trim();
  const field = mode === 'category' ? `cat:${v}`
              : mode === 'author'   ? `au:"${v.replace(/"/g, '')}"`
              :                       `all:"${v.replace(/"/g, '')}"`; // keyword
  const parts = [field];
  const fmt = (d, end) => {
    const dt = new Date(`${d}T00:00:00Z`);
    if (isNaN(dt.getTime())) return null;
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}${end ? '2359' : '0000'}`;
  };
  if (from || to) {
    const lo = (from && fmt(from, false)) || '199101010000';
    const hi = (to && fmt(to, true))     || fmt(new Date().toISOString().slice(0, 10), true);
    if (lo && hi) parts.push(`submittedDate:[${lo} TO ${hi}]`);
  }
  return parts.join(' AND ');
}

// Bulk-discover papers straight from the arXiv API so users don't have to
// assemble id lists by hand. Modes: category (cat:cs.LG), author (au:"…"),
// keyword (all:"…"), each optionally constrained to a submittedDate window.
//   /api/arxiv-search?mode=category&value=cs.LG&from=2024-01-01&to=2024-12-31&max=200
app.get('/api/arxiv-search', async (req, res) => {
  const mode  = String(req.query.mode ?? 'category');
  const value = String(req.query.value ?? '').trim();
  const from  = req.query.from ? String(req.query.from) : '';
  const to    = req.query.to ? String(req.query.to) : '';
  let max     = parseInt(String(req.query.max ?? '100'), 10);

  if (!['category', 'author', 'keyword'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be category, author, or keyword' });
  }
  if (!value) return res.status(400).json({ error: 'value is required' });
  if (mode === 'category' && !ARXIV_CAT_RE.test(value)) {
    return res.status(400).json({ error: `"${value}" is not a valid arXiv category (e.g. cs.LG, math.AP, hep-th)` });
  }
  if (!Number.isFinite(max) || max < 1) max = 100;
  max = Math.min(max, 1000);

  const searchQuery = buildArxivSearchQuery({ mode, value, from, to });
  const perPage = 100;
  const all = [];
  const seen = new Set();
  try {
    for (let start = 0; start < max; start += perPage) {
      const want = Math.min(perPage, max - start);
      const xml  = await arxivSearchFetch(searchQuery, start, want);
      const metas = extractAllArxivMetadata(xml);
      if (metas.length === 0) break;                  // no more results
      for (const m of metas) {
        if (!seen.has(m.arxivId)) { seen.add(m.arxivId); all.push(m); }
      }
      if (metas.length < want) break;                 // reached the end
    }
  } catch (err) {
    if (all.length === 0) {
      // 429 = arXiv is rate-limiting us; give the user an actionable message.
      if (/\b429\b/.test(err.message)) {
        return res.status(429).json({ error: 'arXiv is rate-limiting requests right now. Wait ~30 seconds and try again — and consider importing one category at a time.' });
      }
      return res.status(502).json({ error: `arXiv search failed: ${err.message}` });
    }
    // Otherwise fall through and return whatever we managed to collect.
  }

  res.json({ results: all.slice(0, max), total: all.length, truncated: all.length >= max });
});

app.get('/api/arxiv-abstract', async (req, res) => {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id is required' });

  const cached = abstractCache.get(id);
  if (cached && Date.now() - cached.ts < ABSTRACT_TTL_MS) {
    return res.json({ abstract: cached.abstract, source: cached.source, cached: true });
  }
  const neg = abstractNegCache.get(id);
  if (neg && Date.now() - neg.ts < ABSTRACT_NEG_TTL_MS) {
    return res.status(503).json({ error: neg.error, retryAfter: Math.ceil((ABSTRACT_NEG_TTL_MS - (Date.now() - neg.ts)) / 1000) });
  }

  let abstract;
  let source;
  let arxivErr;
  try {
    abstract = await fetchFromArxiv(id);
    source   = 'arxiv';
  } catch (e) {
    arxivErr = e.message;
    console.warn(`[abstract] arXiv failed for ${id}: ${arxivErr} — falling back to Semantic Scholar`);
    try {
      abstract = await fetchFromSemanticScholar(id);
      source   = 'semantic-scholar';
    } catch (e2) {
      const msg = `Both sources failed (arXiv: ${arxivErr}; S2: ${e2.message})`;
      abstractNegCache.set(id, { error: msg, ts: Date.now() });
      return res.status(502).json({ error: msg });
    }
  }

  abstractCache.set(id, { abstract, source, ts: Date.now() });
  res.json({ abstract, source });
});

// ---------- Semantic Scholar proxy (search / refs / citations / recs) ----------
// All S2 calls share the s2Queue + 1.1s min-gap defined above. Each endpoint
// caches results in a small LRU-ish map keyed by (path + query) for 1h.
const s2Cache = new Map(); // cacheKey -> { data, ts }
const S2_CACHE_TTL_MS = 60 * 60 * 1000;

const S2_PAPER_FIELDS = [
  'paperId', 'externalIds', 'title', 'abstract', 'authors.name', 'authors.authorId',
  'year', 'venue', 'citationCount', 'influentialCitationCount',
  'publicationTypes', 'openAccessPdf', 'url', 'tldr',
].join(',');

// References/citations endpoints don't accept the dotted author or tldr
// sub-fields under the nested citedPaper./citingPaper. prefix.
const S2_NESTED_PAPER_FIELDS = [
  'paperId', 'externalIds', 'title', 'abstract', 'authors',
  'year', 'venue', 'citationCount', 'influentialCitationCount',
  'publicationTypes', 'openAccessPdf', 'url',
].join(',');

async function s2Get(pathWithQuery, apiKey) {
  const cached = s2Cache.get(pathWithQuery);
  if (cached && Date.now() - cached.ts < S2_CACHE_TTL_MS) return cached.data;
  return s2Queue = s2Queue.then(async () => {
    const wait = Math.max(0, S2_MIN_GAP_MS - (Date.now() - lastS2Call));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastS2Call = Date.now();
    const url = `https://api.semanticscholar.org${pathWithQuery}`;
    const headers = {
      Accept: 'application/json',
      'User-Agent': 'arxiv-mail-reader/1.0 (https://github.com/gerryfrank10/arxiv-mail-reader)',
    };
    if (apiKey) headers['x-api-key'] = apiKey;
    // Short backoff because we have OpenAlex as a fallback for search
    const BACKOFFS = [2000, 5000];
    let r;
    for (let i = 0; i <= BACKOFFS.length; i++) {
      r = await fetch(url, { headers });
      if (r.status !== 429) break;
      if (i === BACKOFFS.length) break;
      console.warn(`[s2] 429 on ${pathWithQuery}, backing off ${BACKOFFS[i]}ms (attempt ${i + 1}/${BACKOFFS.length})`);
      await new Promise(res => setTimeout(res, BACKOFFS[i]));
    }
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      const err = new Error(`S2 ${r.status}: ${text.slice(0, 140)}`);
      err.status = r.status;
      throw err;
    }
    const data = await r.json();
    s2Cache.set(pathWithQuery, { data, ts: Date.now() });
    return data;
  }).catch(err => { throw err; });
}

// ---------- OpenAlex fallback (no rate limits, polite-pool via mailto) ----------
const POLITE_MAILTO = process.env.OPENALEX_MAILTO || 'arxiv-mail-reader@example.com';
const OPENALEX_MIN_GAP_MS = 200; // very generous, OpenAlex doesn't really throttle
let lastOpenAlexCall = 0;
let openAlexQueue = Promise.resolve();

async function openAlexGet(pathWithQuery) {
  const cacheKey = `oa:${pathWithQuery}`;
  const cached = s2Cache.get(cacheKey);
  if (cached && Date.now() - cached.ts < S2_CACHE_TTL_MS) return cached.data;
  return openAlexQueue = openAlexQueue.then(async () => {
    const wait = Math.max(0, OPENALEX_MIN_GAP_MS - (Date.now() - lastOpenAlexCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastOpenAlexCall = Date.now();
    const sep = pathWithQuery.includes('?') ? '&' : '?';
    const url = `https://api.openalex.org${pathWithQuery}${sep}mailto=${encodeURIComponent(POLITE_MAILTO)}`;
    const r = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': `arxiv-mail-reader/1.0 (mailto:${POLITE_MAILTO})`,
      },
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      throw new Error(`OpenAlex ${r.status}: ${text.slice(0, 140)}`);
    }
    const data = await r.json();
    s2Cache.set(cacheKey, { data, ts: Date.now() });
    return data;
  }).catch(err => { throw err; });
}

// Map an OpenAlex Work to the S2Paper shape used by the client
function openAlexToS2Paper(w) {
  const arxivId = (() => {
    // OpenAlex sometimes puts arXiv in `ids.arxiv` (full URL) or in `locations`
    const fromIds = w.ids?.arxiv;
    if (typeof fromIds === 'string') {
      const m = fromIds.match(/(\d{4}\.\d{4,5}(v\d+)?)/);
      if (m) return m[1];
    }
    // Look in primary_location and locations for arxiv urls
    const urls = [w.primary_location?.landing_page_url, ...(w.locations ?? []).map(l => l?.landing_page_url)].filter(Boolean);
    for (const u of urls) {
      const m = String(u).match(/arxiv\.org\/abs\/(\d{4}\.\d{4,5}(v\d+)?)/i);
      if (m) return m[1];
    }
    return undefined;
  })();
  const doi = w.doi?.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  const oaUrl = w.open_access?.oa_url || w.primary_location?.pdf_url;
  return {
    paperId: String(w.id ?? '').replace('https://openalex.org/', ''),
    externalIds: {
      ...(arxivId ? { ArXiv: arxivId } : {}),
      ...(doi     ? { DOI: doi }       : {}),
      OpenAlex: String(w.id ?? '').replace('https://openalex.org/', ''),
    },
    title:        w.title || w.display_name || '(untitled)',
    abstract:     null,
    authors:      (w.authorships ?? []).map(a => ({
      authorId: String(a?.author?.id ?? '').replace('https://openalex.org/', '') || undefined,
      name:     a?.author?.display_name ?? '',
    })),
    year:         w.publication_year ?? null,
    venue:        w.primary_location?.source?.display_name ?? w.host_venue?.display_name ?? null,
    citationCount: w.cited_by_count ?? 0,
    influentialCitationCount: 0,
    publicationTypes: w.type ? [w.type] : null,
    openAccessPdf: oaUrl ? { url: oaUrl } : null,
    url:          w.id,
    tldr:         null,
  };
}

// Pull optional S2 key from request header so the client can pass through a
// user-supplied key from Settings without exposing it on the server.
function s2KeyFrom(req) {
  return req.get('x-s2-api-key') || process.env.SEMANTIC_SCHOLAR_API_KEY || undefined;
}

// GET /api/s2/search?q=world+models&limit=100
// Falls back to OpenAlex when Semantic Scholar rate-limits us.
app.get('/api/s2/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  const limit = Math.min(Number(req.query.limit) || 100, 100);
  const params = new URLSearchParams({ query: q, limit: String(limit), fields: S2_PAPER_FIELDS });
  try {
    const data = await s2Get(`/graph/v1/paper/search?${params}`, s2KeyFrom(req));
    res.json({ ...data, source: 'semantic-scholar' });
  } catch (e) {
    // On rate limit / failure, fall back to OpenAlex with the same response shape
    console.warn(`[search] S2 failed ("${e.message}") — falling back to OpenAlex`);
    try {
      const oaParams = new URLSearchParams({
        search: q,
        per_page: String(Math.min(limit, 50)),
        sort: 'relevance_score:desc',
      });
      const oaData = await openAlexGet(`/works?${oaParams}`);
      const works  = (oaData.results ?? []).map(openAlexToS2Paper);
      res.json({
        total: oaData.meta?.count ?? works.length,
        offset: 0,
        data: works,
        source: 'openalex',
      });
    } catch (e2) {
      res.status(502).json({
        error: `Both Semantic Scholar and OpenAlex failed (S2: ${e.message}; OpenAlex: ${e2.message})`,
      });
    }
  }
});

// GET /api/s2/paper/:id   (id can be DOI, S2 id, ARXIV:..., or just an arxivId — we'll prefix)
app.get('/api/s2/paper/:id', async (req, res) => {
  const id = normalizePaperId(req.params.id);
  const params = new URLSearchParams({ fields: S2_PAPER_FIELDS });
  try {
    const data = await s2Get(`/graph/v1/paper/${encodeURIComponent(id)}?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/s2/paper/:id/references
app.get('/api/s2/paper/:id/references', async (req, res) => {
  const id = normalizePaperId(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const params = new URLSearchParams({
    limit: String(limit),
    fields: 'contexts,intents,isInfluential,' + S2_NESTED_PAPER_FIELDS.split(',').map(f => `citedPaper.${f}`).join(','),
  });
  try {
    const data = await s2Get(`/graph/v1/paper/${encodeURIComponent(id)}/references?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    // Fallback: OpenAlex `referenced_works` on the paper
    console.warn(`[refs] S2 failed for ${id} ("${e.message}") — falling back to OpenAlex`);
    try {
      const oaId = await openAlexIdFromArxiv(req.params.id);
      if (!oaId) throw new Error('No OpenAlex id found for this paper');
      const work = await openAlexGet(`/works/${encodeURIComponent(oaId)}`);
      const refIds = (work.referenced_works ?? []).slice(0, limit);
      if (refIds.length === 0) return res.json({ data: [], source: 'openalex' });
      // Batch-fetch the referenced works
      const filter = `openalex:${refIds.map(u => String(u).replace('https://openalex.org/', '')).join('|')}`;
      const batch  = await openAlexGet(`/works?filter=${encodeURIComponent(filter)}&per_page=${refIds.length}`);
      const data   = (batch.results ?? []).map(w => ({ citedPaper: openAlexToS2Paper(w) }));
      res.json({ data, source: 'openalex' });
    } catch (e2) {
      res.status(502).json({ error: `S2 and OpenAlex both failed (${e.message}; ${e2.message})` });
    }
  }
});

// GET /api/s2/paper/:id/citations
app.get('/api/s2/paper/:id/citations', async (req, res) => {
  const id = normalizePaperId(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const params = new URLSearchParams({
    limit: String(limit),
    fields: 'contexts,intents,isInfluential,' + S2_NESTED_PAPER_FIELDS.split(',').map(f => `citingPaper.${f}`).join(','),
  });
  try {
    const data = await s2Get(`/graph/v1/paper/${encodeURIComponent(id)}/citations?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    // Fallback: OpenAlex `cites:Wxxx` filter
    console.warn(`[cites] S2 failed for ${id} ("${e.message}") — falling back to OpenAlex`);
    try {
      const oaId = await openAlexIdFromArxiv(req.params.id);
      if (!oaId) throw new Error('No OpenAlex id found for this paper');
      const oaShortId = String(oaId).replace('https://openalex.org/', '');
      const batch = await openAlexGet(
        `/works?filter=cites:${encodeURIComponent(oaShortId)}&per_page=${limit}&sort=cited_by_count:desc`,
      );
      const data = (batch.results ?? []).map(w => ({ citingPaper: openAlexToS2Paper(w) }));
      res.json({ data, source: 'openalex' });
    } catch (e2) {
      res.status(502).json({ error: `S2 and OpenAlex both failed (${e.message}; ${e2.message})` });
    }
  }
});

// Resolve an arXiv ID (or already-OpenAlex id) to an OpenAlex work id.
// Recent arXiv papers have DOIs of the form 10.48550/arXiv.{arxivId}.
// Older papers (pre-2022) often don't — for those we fall back to a
// landing_page_url search.
async function openAlexIdFromArxiv(raw) {
  const s = String(raw).trim();
  if (/^W\d+$/i.test(s)) return `https://openalex.org/${s}`;
  if (s.startsWith('https://openalex.org/W')) return s;
  const arxivMatch = s.match(/^(?:arXiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/i) || s.match(/^([a-z-]+\/\d{7})$/i);
  if (!arxivMatch) return null;
  const arxivId = arxivMatch[1];

  // 1. Try direct DOI lookup (works for papers since ~2022)
  try {
    const work = await openAlexGet(`/works/doi:10.48550/arXiv.${encodeURIComponent(arxivId)}`);
    if (work?.id) return work.id;
  } catch { /* fall through */ }

  // 2. Try searching for the landing-page URL substring
  try {
    const search = await openAlexGet(
      `/works?filter=locations.landing_page_url.search:${encodeURIComponent(`arxiv.org/abs/${arxivId}`)}&per_page=1`
    );
    if (search?.results?.[0]?.id) return search.results[0].id;
  } catch { /* fall through */ }

  // 3. Final fallback: a free-text search for the arXiv id string
  try {
    const search = await openAlexGet(`/works?search=${encodeURIComponent(arxivId)}&per_page=1`);
    return search?.results?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

// GET /api/s2/paper/:id/recommendations
app.get('/api/s2/paper/:id/recommendations', async (req, res) => {
  const id = normalizePaperId(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 20, 50);
  const params = new URLSearchParams({ limit: String(limit), fields: S2_PAPER_FIELDS });
  try {
    const data = await s2Get(`/recommendations/v1/papers/forpaper/${encodeURIComponent(id)}?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/s2/author/:id  — author profile + recent papers
app.get('/api/s2/author/:id', async (req, res) => {
  const id = encodeURIComponent(req.params.id);
  try {
    const key = s2KeyFrom(req);
    const author = await s2Get(`/graph/v1/author/${id}?fields=name,affiliations,hIndex,citationCount,paperCount,url`, key);
    const papers = await s2Get(
      `/graph/v1/author/${id}/papers?limit=20&fields=${encodeURIComponent(S2_PAPER_FIELDS)}`,
      key,
    );
    res.json({ author, papers: papers.data ?? [] });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Accept inputs like "2402.05576", "arXiv:2402.05576", "10.1234/foo", or a raw S2 paperId
function normalizePaperId(raw) {
  const s = String(raw).trim();
  // If it already has a scheme prefix, keep it
  if (/^(arXiv|DOI|MAG|ACL|PMID|PMCID|CorpusId|URL):/i.test(s)) return s;
  // Pure arXiv id (new style 2402.05576 or old style cs/0701001)
  if (/^\d{4}\.\d{4,5}(v\d+)?$/.test(s) || /^[a-z-]+\/\d{7}$/i.test(s)) return `arXiv:${s}`;
  // DOI heuristic
  if (s.startsWith('10.') && s.includes('/')) return `DOI:${s}`;
  return s;
}

// ---------- Generic AI proxy (OpenAI-compatible providers + Ollama) ----------
// When the server runs inside a container, a user-configured AI base URL like
// http://localhost:11434 points at the CONTAINER, not the host where Ollama
// runs. Setting LOCALHOST_PROXY_HOST (compose sets it to host.docker.internal)
// transparently rewrites localhost/127.0.0.1 so the browser config still works
// in both dev (no env → unchanged) and Docker. Public URLs are untouched.
function resolveUpstreamBase(baseUrl) {
  const clean = String(baseUrl).replace(/\/+$/, '');
  const proxyHost = process.env.LOCALHOST_PROXY_HOST;
  if (!proxyHost) return clean;
  return clean.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/i, `$1${proxyHost}`);
}

// Browser → /api/ai/chat → upstream. Lets us avoid CORS on localhost (Ollama)
// and on any OpenAI-compatible endpoint the user configures.
app.post('/api/ai/chat', async (req, res) => {
  const { provider, baseUrl, apiKey, model, messages, maxTokens = 1024, temperature = 0.4 } = req.body || {};
  if (!baseUrl || !model || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'baseUrl, model and messages are required' });
  }
  if (!['openai', 'groq', 'ollama', 'custom'].includes(provider)) {
    return res.status(400).json({ error: `Unsupported provider: ${provider}` });
  }
  const url = `${resolveUpstreamBase(baseUrl)}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  try {
    const upstream = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature,
        stream: false,
      }),
      // Generous timeout so local Ollama (often slow on first token) doesn't
      // get killed prematurely. Browser-side AbortController still applies.
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => '');
      return res.status(upstream.status).json({
        error: `${provider} ${upstream.status}: ${body.slice(0, 300)}`,
      });
    }
    const data = await upstream.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    res.json({ text, model: data?.model, usage: data?.usage });
  } catch (e) {
    res.status(502).json({ error: `Upstream failed (${provider}): ${e.message}` });
  }
});

app.post('/api/fetch-imap-emails', async (req, res) => {
  const { senderEmail, maxEmails = 30 } = req.body ?? {};
  let imapConfig;

  if (db.enabled) {
    try {
      const who = await resolveRequestUser(req);
      if (!who) return res.status(401).json({ error: 'Unauthorized — please sign in.' });
      imapConfig = await db.getImapConfig(who.id);
    } catch (err) {
      console.error('[imap] could not load saved mailbox credentials:', err.message);
      return res.status(500).json({ error: 'Could not load saved mailbox credentials.' });
    }
    if (!imapConfig) {
      return res.status(400).json({ error: 'Add your mailbox credentials in Settings → Email & sync.' });
    }
  } else {
    // Keep the no-database development mode working; signed-in accounts always
    // use the encrypted credentials stored on their user row above.
    const { host, port = 993, username, password } = req.body ?? {};
    imapConfig = { host, port, username, password };
  }

  const { host, port = 993, username, password } = imapConfig;

  if (!host || !username || !password || !senderEmail) {
    return res.status(400).json({ error: 'host, username, password, and senderEmail are required.' });
  }

  const client = new ImapFlow({
    host,
    port: Number(port),
    secure: true,
    auth: { user: username, pass: password },
    logger: false,
    tls: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
  } catch (err) {
    return res.status(401).json({ error: `Connection failed: ${err.message}` });
  }

  let lock;
  try {
    lock = await client.getMailboxLock('INBOX');
    const uids = await client.search({ from: senderEmail });

    if (!uids.length) {
      lock.release();
      await client.logout();
      return res.json({ emails: [] });
    }

    const slice = uids.slice(-Math.min(Number(maxEmails), uids.length));
    const emails = [];

    for await (const msg of client.fetch(slice, { source: true, envelope: true })) {
      try {
        // skipTextToHtml: we only use parsed.text, and mailparser's
        // text->html pass runs linkify-it over the body — its fuzzy regex
        // blows up quadratically on pathological emails (one long unbroken
        // token run pinned the event loop for ~40min). Skipping it removes
        // the only such path; text parts are still parsed normally.
        const parsed = await simpleParser(msg.source, { skipTextToHtml: true });
        emails.push({
          id: String(msg.uid),
          subject: parsed.subject ?? msg.envelope?.subject ?? '',
          date: parsed.date?.toISOString() ?? msg.envelope?.date?.toISOString() ?? '',
          body: parsed.text ?? '',
        });
      } catch { /* skip malformed messages */ }
    }

    lock.release();
    await client.logout();

    emails.reverse(); // newest first
    res.json({ emails });
  } catch (err) {
    lock?.release();
    try { await client.logout(); } catch { /* ignore */ }
    res.status(500).json({ error: err.message });
  }
});

// ---------- Postgres-backed CRUD (opt-in via DATABASE_URL) ----------
// All routes scoped by the X-User-Email header (set by client).
async function withUser(req, res, run) {
  if (!db.enabled) {
    return res.status(503).json({ error: 'Server storage is not enabled (no DATABASE_URL set).' });
  }
  try {
    const who = await resolveRequestUser(req);
    if (!who) return res.status(401).json({ error: 'Unauthorized — please sign in.' });
    await run(who.id);
  } catch (e) {
    console.error('[db] route error:', e);
    res.status(500).json({ error: e.message });
  }
}

function bearerToken(req) {
  const h = req.get('authorization') ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

// Identity comes from a login session (primary). The old shared APP_AUTH_TOKEN
// remains only as an optional API fallback alongside x-user-email.
async function resolveRequestUser(req) {
  const token = bearerToken(req) || String(req.query.token ?? '').trim();
  if (token) {
    const session = await db.getSessionUser(token);
    if (session) return session;
    if (AUTH_TOKEN && safeEqual(token, AUTH_TOKEN)) {
      const email = req.get('x-user-email') || req.query.email;
      if (email) {
        const id = await db.userIdForEmail(String(email));
        return { id, email: String(email) };
      }
    }
  }
  return null;
}

app.get('/api/db/status', (_req, res) => res.json({ enabled: db.enabled }));

app.get('/api/db/mailbox-config', (req, res) => withUser(req, res, async (uid) => {
  res.json({ imapConfig: await db.getImapConfig(uid) });
}));

app.put('/api/db/mailbox-config', (req, res) => withUser(req, res, async (uid) => {
  const config = req.body?.imapConfig;
  if (config === null) {
    await db.saveImapConfig(uid, null);
    return res.json({ ok: true });
  }

  const host = String(config?.host ?? '').trim();
  const username = String(config?.username ?? '').trim();
  const password = String(config?.password ?? '');
  const port = Number(config?.port);
  if (!host || !username || !password || !Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: 'Valid host, port, username, and password are required.' });
  }

  await db.saveImapConfig(uid, { host, port, username, password });
  res.json({ ok: true });
}));

// ---------- durable source ingestion jobs ----------
app.get('/api/db/ingest/jobs', (req, res) => withUser(req, res, async (uid) => {
  res.json({ jobs: await db.listIngestJobs(uid) });
}));

app.post('/api/db/ingest/jobs', (req, res) => {
  const sourceId = String(req.body?.sourceId ?? 'arxiv');
  const source = getSourcePlugin(sourceId);
  if (!source) return res.status(400).json({ error: `Source plugin "${sourceId}" is not installed.` });
  let planned;
  try {
    planned = source.plan(req.body ?? {});
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  return withUser(req, res, async (uid) => {
    const job = await db.createIngestJob(uid, source.id, planned.config, planned.slices.length);
    res.status(201).json({ job });
  });
});

app.get('/api/db/ingest/jobs/:id', (req, res) => withUser(req, res, async (uid) => {
  const job = await db.getIngestJob(uid, req.params.id);
  if (!job) return res.status(404).json({ error: 'Import job not found.' });
  res.json({ job });
}));

app.post('/api/db/ingest/jobs/:id/:action', (req, res) => withUser(req, res, async (uid) => {
  const { action } = req.params;
  if (!['pause', 'resume', 'cancel'].includes(action)) {
    return res.status(400).json({ error: 'Action must be pause, resume, or cancel.' });
  }
  const job = await db.updateIngestJobState(uid, req.params.id, action);
  if (!job) return res.status(404).json({ error: 'Import job not found.' });
  if (action === 'resume' && job.status === 'failed' && job.errorDetails?.resumeAfter) {
    const resumeAfter = Date.parse(job.errorDetails.resumeAfter);
    if (Number.isFinite(resumeAfter) && resumeAfter > Date.now()) {
      const waitMinutes = Math.ceil((resumeAfter - Date.now()) / 60_000);
      return res.status(429).json({ error: `This rate-limited job can be resumed in about ${waitMinutes} minute${waitMinutes === 1 ? '' : 's'}.` });
    }
  }
  res.json({ job });
}));

// ---------- accounts (email + password) ----------
const LOGIN_WINDOW_MS = 5 * 60_000;
const LOGIN_MAX_TRIES = 10;
const loginTries = new Map();

function loginKey(req, email) { return `${req.ip}|${String(email).toLowerCase()}`; }
function tooManyTries(key) {
  const now = Date.now();
  const t = loginTries.get(key);
  if (!t || t.resetAt <= now) {
    loginTries.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return false;
  }
  return t.count >= LOGIN_MAX_TRIES;
}
function noteFailure(key) {
  const t = loginTries.get(key);
  if (t) t.count += 1;
}

const validEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

app.post('/api/auth/login', async (req, res) => {
  if (!db.enabled) return res.status(503).json({ error: 'Database is not enabled.' });
  const email    = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  const key = loginKey(req, email);
  if (tooManyTries(key)) return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  try {
    const user = await db.authenticateUser(email, password);
    if (!user) {
      noteFailure(key);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    loginTries.delete(key);
    const token = await db.createSession(user.id);
    res.json({ token, user: { email: user.email } });
  } catch (e) {
    console.error('[auth] login failed:', e.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

app.post('/api/auth/register', async (req, res) => {
  if (!db.enabled) return res.status(503).json({ error: 'Database is not enabled.' });
  const email    = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!validEmail(email))        return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 8)       return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  try {
    const user = await db.createUser(email, password);
    const token = await db.createSession(user.id);
    res.json({ token, user: { email: user.email } });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' });
    console.error('[auth] register failed:', e.message);
    res.status(500).json({ error: 'Could not create the account.' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try { await db.deleteSession(bearerToken(req)); } catch { /* ignore */ }
  res.json({ ok: true });
});

app.get('/api/auth/me', async (req, res) => {
  if (!db.enabled) return res.status(503).json({ error: 'Database is not enabled.' });
  try {
    const user = await db.getSessionUser(bearerToken(req));
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    res.json({ user: { email: user.email } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/password', async (req, res) => {
  if (!db.enabled) return res.status(503).json({ error: 'Database is not enabled.' });
  const current = String(req.body?.currentPassword ?? '');
  const next    = String(req.body?.newPassword ?? '');
  if (next.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  try {
    const user = await db.getSessionUser(bearerToken(req));
    if (!user) return res.status(401).json({ error: 'Not signed in.' });
    const ok = await db.changePassword(user.id, current, next);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect.' });
    // changePassword clears all sessions; issue a fresh one for this browser.
    const token = await db.createSession(user.id);
    res.json({ ok: true, token });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Gate every DB route (status above stays public so the client can detect an
// unavailable DB). Browser-direct file URLs can't set headers, so the token is
// also accepted as ?token=… for those routes only.
// papers
app.get('/api/db/papers', (req, res) => withUser(req, res, async (uid) => {
  const limit  = Math.min(20000, Math.max(0, Math.trunc(Number(req.query.limit)  || 0)));
  const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
  const { papers, total } = await db.getPapers(uid, { limit, offset });
  res.json({ papers, total, hasMore: limit > 0 && offset + papers.length < total });
}));
app.get('/api/db/papers/relevant', (req, res) => withUser(req, res, async (uid) => {
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 10)));
  const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
  const { papers, total } = await db.getRelevantPapers(uid, { limit, offset });
  res.json({ papers, total, hasMore: offset + papers.length < total });
}));
app.get('/api/db/papers/search', (req, res) => withUser(req, res, async (uid) => {
  const query = String(req.query.q ?? '').trim();
  const limit = Math.min(250, Math.max(1, Math.trunc(Number(req.query.limit) || 100)));
  const offset = Math.max(0, Math.trunc(Number(req.query.offset) || 0));
  const { papers, total } = await db.searchPapers(uid, query, { limit, offset });
  res.json({ papers, total, hasMore: offset + papers.length < total });
}));
app.get('/api/db/papers/:id', (req, res) => withUser(req, res, async (uid) => {
  const paper = await db.getPaper(uid, req.params.id);
  if (!paper) return res.status(404).json({ error: 'Paper not found.' });
  res.json({ paper });
}));
app.get('/api/db/stats', (req, res) => withUser(req, res, async (uid) => {
  res.json(await db.getStats(uid));
}));
app.post('/api/db/papers/existing', (req, res) => withUser(req, res, async (uid) => {
  const arxivIds = Array.isArray(req.body.arxivIds) ? req.body.arxivIds.slice(0, 5000) : [];
  res.json({ arxivIds: await db.getExistingArxivIds(uid, arxivIds) });
}));
app.post('/api/db/papers', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertPapers(uid, req.body.papers ?? []);
  res.json({ ok: true });
}));
app.patch('/api/db/papers/:id/abstract', (req, res) => withUser(req, res, async (uid) => {
  await db.updateAbstract(uid, req.params.id, req.body.abstract ?? '');
  res.json({ ok: true });
}));

// per-paper comments (dashboard feed)
app.get('/api/db/papers/:id/comments', (req, res) => withUser(req, res, async (uid) => {
  res.json({ comments: await db.getPaperComments(uid, req.params.id) });
}));
app.post('/api/db/papers/:id/comments', (req, res) => withUser(req, res, async (uid) => {
  const comment = await db.addPaperComment(uid, req.params.id, req.body.body ?? '');
  res.json({ comment });
}));
app.delete('/api/db/comments/:id', (req, res) => withUser(req, res, async (uid) => {
  const removed = await db.deletePaperComment(uid, req.params.id);
  res.json({ ok: removed });
}));
app.post('/api/db/comments/counts', (req, res) => withUser(req, res, async (uid) => {
  res.json({ counts: await db.getCommentCounts(uid, req.body.ids ?? []) });
}));

// ---------- organization lookup (company / lab per paper) ----------
// arXiv metadata has no affiliations, so the company behind a paper is read
// from the first page of its PDF, one paper at a time through the same
// politeness queue as PDF caching. Results are stored, so each paper is read
// once. The feed polls this for the papers on screen.
const orgInFlight = new Set();

function resolveOrganizations(userId, rows) {
  for (const row of rows) {
    const key = `${userId}:${row.id}`;
    if (orgInFlight.has(key)) continue;
    const bare = String(row.arxivId ?? '').trim().replace(/v\d+$/i, '');
    if (!/^(\d{4}\.\d{4,5}|[a-z-]+(\.[A-Z]{2})?\/\d{7})$/i.test(bare)) {
      // Not an arXiv id (local upload, malformed import): nothing to read.
      db.setOrganization(userId, row.id, null).catch(() => {});
      continue;
    }
    orgInFlight.add(key);
    enqueuePdfFetch(async () => {
      try {
        const buf = await downloadArxivPdf(bare);
        const text = await withTimeout(extractPaperText(buf), 45_000, 'organization read timed out');
        await db.setOrganization(userId, row.id, detectOrganization(text));
      } catch (e) {
        // Mark it checked so a broken PDF isn't retried on every poll.
        console.warn(`[organizations] ${bare}: ${e.message}`);
        await db.setOrganization(userId, row.id, null).catch(() => {});
      } finally {
        orgInFlight.delete(key);
      }
    });
  }
}

app.post('/api/db/organizations', (req, res) => withUser(req, res, async (uid) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).slice(0, 100).map(String);
  const rows = await db.getOrganizations(uid, ids);
  const organizations = {};
  const pending = [];
  for (const r of rows) {
    if (r.checked) organizations[r.id] = r.organization;
    else pending.push(r);
  }
  resolveOrganizations(uid, pending);
  res.json({ organizations, pending: pending.map(r => r.id) });
}));

// library
app.get('/api/db/library', (req, res) => withUser(req, res, async (uid) => {
  res.json({ items: await db.getLibrary(uid) });
}));
app.put('/api/db/library/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.savePaper(uid, req.params.id); res.json({ ok: true });
}));
app.delete('/api/db/library/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.unsavePaper(uid, req.params.id); res.json({ ok: true });
}));

// Likes — a lightweight signal distinct from the library (bookmark).
app.get('/api/db/likes', (req, res) => withUser(req, res, async (uid) => {
  res.json({ items: await db.getLikes(uid) });
}));
app.put('/api/db/likes/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.likePaper(uid, req.params.id); res.json({ ok: true });
}));
app.delete('/api/db/likes/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.unlikePaper(uid, req.params.id); res.json({ ok: true });
}));

// read states
app.get('/api/db/read', (req, res) => withUser(req, res, async (uid) => {
  res.json({ ids: await db.getReadIds(uid) });
}));
app.put('/api/db/read', (req, res) => withUser(req, res, async (uid) => {
  await db.setReadIds(uid, req.body.ids ?? []); res.json({ ok: true });
}));
app.post('/api/db/read/add', (req, res) => withUser(req, res, async (uid) => {
  await db.addReadIds(uid, req.body.ids ?? []); res.json({ ok: true });
}));
app.post('/api/db/read/all', (req, res) => withUser(req, res, async (uid) => {
  const marked = await db.markAllRead(uid); res.json({ ok: true, marked });
}));
app.post('/api/db/read/remove', (req, res) => withUser(req, res, async (uid) => {
  await db.removeReadIds(uid, req.body.ids ?? []); res.json({ ok: true });
}));

// trackers
app.get('/api/db/trackers', (req, res) => withUser(req, res, async (uid) => {
  res.json({ trackers: await db.getTrackers(uid) });
}));
app.put('/api/db/trackers/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertTracker(uid, { ...req.body, id: req.params.id }); res.json({ ok: true });
}));
app.delete('/api/db/trackers/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.deleteTracker(uid, req.params.id); res.json({ ok: true });
}));

// scores
app.get('/api/db/scores', (req, res) => withUser(req, res, async (uid) => {
  res.json({ scores: await db.getScores(uid) });
}));
app.post('/api/db/scores', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertScores(uid, req.body.scores ?? []); res.json({ ok: true });
}));
app.delete('/api/db/scores/tracker/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.deleteScoresForTracker(uid, req.params.id); res.json({ ok: true });
}));

// books
app.get('/api/db/books', (req, res) => withUser(req, res, async (uid) => {
  res.json({ books: await db.getBooks(uid) });
}));
app.put('/api/db/books/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertBook(uid, { ...req.body, id: req.params.id }); res.json({ ok: true });
}));
app.delete('/api/db/books/:id', (req, res) => withUser(req, res, async (uid) => {
  // Best-effort: also delete the attached file on disk if any
  try {
    const b = await db.getBook(uid, req.params.id);
    if (b?.filePath && existsSync(b.filePath)) unlinkSync(b.filePath);
  } catch { /* ignore */ }
  await db.deleteBook(uid, req.params.id); res.json({ ok: true });
}));

// ---------- Book file uploads ----------
// PDFs, EPUBs, and similar formats live on disk under ./uploads/books/<user>/<book>.<ext>.
// 50MB cap per file. The book row stores metadata.
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || join(__dirname, '..', 'uploads');
mkdirSync(join(UPLOAD_ROOT, 'books'), { recursive: true });

const bookUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const email = req.get('x-user-email');
      if (!email) return cb(new Error('X-User-Email header required'), '');
      const dir = join(UPLOAD_ROOT, 'books', email.replace(/[^a-z0-9_.@-]/gi, '_'));
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '.bin';
      cb(null, `${req.params.id}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    // Allow common book/document formats
    const okMimes = new Set([
      'application/pdf',
      'application/epub+zip',
      'application/x-mobipocket-ebook',
      'application/vnd.amazon.ebook',
      'application/octet-stream',
      'text/plain',
      'text/markdown',
    ]);
    const okExts = /\.(pdf|epub|mobi|azw3?|djvu|txt|md)$/i;
    if (okMimes.has(file.mimetype) || okExts.test(file.originalname)) cb(null, true);
    else cb(new Error(`Unsupported file type: ${file.mimetype} (${file.originalname})`));
  },
});

app.post('/api/db/books/:id/upload', (req, res) => withUser(req, res, async (uid) => {
  // Make sure the book exists first so we don't dangle a file on disk
  const existing = await db.getBook(uid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'book not found — save it first' });
  // If there's already a file, remove the old one before writing the new
  if (existing.filePath && existsSync(existing.filePath)) {
    try { unlinkSync(existing.filePath); } catch { /* ignore */ }
  }
  bookUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'no file in request (expected field "file")' });
    await db.attachFileToBook(uid, req.params.id, req.file);
    const updated = await db.getBook(uid, req.params.id);
    res.json({ ok: true, book: updated });
  });
}));

app.get('/api/db/books/:id/file', (req, res) => withUser(req, res, async (uid) => {
  const b = await db.getBook(uid, req.params.id);
  if (!b?.filePath || !existsSync(b.filePath)) return res.status(404).json({ error: 'no file attached' });
  res.setHeader('Content-Type', b.mimeType || 'application/octet-stream');
  res.setHeader('Content-Length', String(statSync(b.filePath).size));
  // Inline display so PDFs open in-browser; force download with ?download=1
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition',
    `${disposition}; filename="${(b.originalFilename ?? 'book').replace(/"/g, '')}"`);
  res.sendFile(b.filePath);
}));

app.delete('/api/db/books/:id/file', (req, res) => withUser(req, res, async (uid) => {
  const b = await db.getBook(uid, req.params.id);
  if (b?.filePath && existsSync(b.filePath)) {
    try { unlinkSync(b.filePath); } catch { /* ignore */ }
  }
  await db.clearBookFile(uid, req.params.id);
  res.json({ ok: true });
}));

// ---------- Paper file uploads (locally-uploaded PDFs you read in-app) ----------
// Stored under ./uploads/papers/<user>/<paperId>.<ext>. 50MB cap.
mkdirSync(join(UPLOAD_ROOT, 'papers'), { recursive: true });

const paperUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const email = req.get('x-user-email');
      if (!email) return cb(new Error('X-User-Email header required'), '');
      const dir = join(UPLOAD_ROOT, 'papers', email.replace(/[^a-z0-9_.@-]/gi, '_'));
      mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '.pdf';
      cb(null, `${req.params.id}${ext}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname);
    if (ok) cb(null, true);
    else cb(new Error(`Only PDF files are supported here (got ${file.mimetype || file.originalname})`));
  },
});

app.post('/api/db/papers/:id/upload', (req, res) => withUser(req, res, async (uid) => {
  const existing = await db.getPaper(uid, req.params.id);
  if (!existing) return res.status(404).json({ error: 'paper not found — save it first' });
  if (existing.filePath && existsSync(existing.filePath)) {
    try { unlinkSync(existing.filePath); } catch { /* ignore */ }
  }
  paperUpload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'no file in request (expected field "file")' });
    await db.attachFileToPaper(uid, req.params.id, req.file);
    const updated = await db.getPaper(uid, req.params.id);
    res.json({ ok: true, paper: updated });
    // Extract the text for search / AI in the background (PDF opens first).
    scheduleTextExtraction(uid, req.params.id, req.file.path);
  });
}));

app.get('/api/db/papers/:id/file', (req, res) => withUser(req, res, async (uid) => {
  const p = await db.getPaper(uid, req.params.id);
  const filePath = resolvePaperFilePath(p, req.get('x-user-email') || req.query.email);
  if (!filePath) return res.status(404).json({ error: 'no file attached' });
  res.setHeader('Content-Type', p.mimeType || 'application/pdf');
  res.setHeader('Content-Length', String(statSync(filePath).size));
  const disposition = req.query.download ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition',
    `${disposition}; filename="${(p.originalFilename ?? 'paper.pdf').replace(/"/g, '')}"`);
  res.sendFile(filePath);
}));

app.delete('/api/db/papers/:id/file', (req, res) => withUser(req, res, async (uid) => {
  const p = await db.getPaper(uid, req.params.id);
  const filePath = resolvePaperFilePath(p, req.get('x-user-email') || req.query.email);
  if (filePath) {
    try { unlinkSync(filePath); } catch { /* ignore */ }
  }
  await db.clearPaperFile(uid, req.params.id);
  await db.clearPaperText(uid, req.params.id);
  res.json({ ok: true });
}));

// ---------- Full-text caching for arXiv papers ----------
//
// Opening an arXiv paper used to mean a fresh request to arxiv.org every time
// (slow, and unusable offline). These routes download the PDF once, keep it on
// disk under ./uploads/papers/<user>/, and extract its plain text into
// papers.full_text so search + AI can use the whole document. Repeated opens
// are served straight from the local file via /api/db/papers/:id/file.
//
// Downloads are serialised with the same politeness gap arXiv asks for, so a
// "cache my whole library" run can't burst past their rate limit.
const PDF_MIN_GAP_MS = Number(process.env.ARXIV_PDF_GAP_MS || 3200);
const PDF_MAX_BYTES  = 100 * 1024 * 1024;   // 100 MB safety cap
const FULL_TEXT_MAX  =  8 * 1024 * 1024;    // chars stored per paper
let lastPdfFetch = 0;
let pdfQueue = Promise.resolve();
const downloadInFlight = new Map();

function enqueuePdfFetch(fn) {
  const run = pdfQueue.then(async () => {
    const wait = Math.max(0, PDF_MIN_GAP_MS - (Date.now() - lastPdfFetch));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastPdfFetch = Date.now();
    return fn();
  });
  // Keep the chain usable after a failed download.
  pdfQueue = run.then(() => {}, () => {});
  return run;
}

async function downloadArxivPdf(arxivId) {
  const id = String(arxivId).trim().replace(/^arxiv:/i, '');
  if (!/^[a-z0-9][a-z0-9./-]*$/i.test(id) || id.includes('..')) {
    throw new Error(`Invalid arXiv id: ${arxivId}`);
  }
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const r = await fetch(`https://arxiv.org/pdf/${id}`, {
      headers: { ...ARXIV_HEADERS, Accept: 'application/pdf' },
      redirect: 'follow',
      signal: ctrl.signal,
    });
    if (!r.ok) throw new Error(`arXiv PDF request failed (HTTP ${r.status})`);
    const type = (r.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('text/html')) throw new Error('arXiv returned an HTML page instead of the PDF');
    const declared = Number(r.headers.get('content-length') ?? 0);
    if (declared > PDF_MAX_BYTES) throw new Error('PDF is larger than the 100 MB cache limit');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > PDF_MAX_BYTES) throw new Error('PDF is larger than the 100 MB cache limit');
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Downloaded file is not a PDF');
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

async function extractPaperText(buffer) {
  const { text } = await extractPdfTextRaw(new Uint8Array(buffer), { mergePages: true });
  const merged = Array.isArray(text) ? text.join('\n\n') : String(text ?? '');
  return sanitizePdfText(merged);
}

// PDF text frequently contains NUL bytes and other control characters (they
// come from embedded fonts/CMaps). Postgres `text` cannot store U+0000, so an
// otherwise-successful extraction would fail at the insert step — that is why
// some papers cached fine and others never got full text. Strip them here.
function sanitizePdfText(input) {
  return String(input ?? '')
    .replace(/\u0000/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

const extractionInFlight = new Set();
// After a real failure, don't let the client's 3s polling spin re-extraction
// forever; wait a bit before allowing another attempt.
const extractionCooldown = new Map();

// PDF.js/unpdf is not safe to run many extractions through at once: with a
// bulk warm-up and several open papers, parallel calls intermittently hang
// forever and leave papers stuck as "text pending". Serialise the work.
let extractionQueue = Promise.resolve();
const thumbnailInFlight = new Map();
function enqueueExtraction(fn) {
  const run = extractionQueue.then(fn);
  extractionQueue = run.then(() => {}, () => {});
  return run;
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Text extraction runs after the HTTP response so the PDF opens immediately;
// the client polls /fulltext until `ready` flips to true.
function scheduleTextExtraction(userId, paperId, filePath) {
  if (extractionInFlight.has(paperId)) return;
  if ((extractionCooldown.get(paperId) ?? 0) > Date.now()) return;
  extractionInFlight.add(paperId);
  enqueueExtraction(async () => {
    let lastError;
    // PDF parsing is occasionally flaky (large/font-heavy files); a couple of
    // attempts makes it predictable without changing successful runs.
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const buf  = readFileSync(filePath);
        const text = await withTimeout(
          extractPaperText(buf),
          45_000,
          'text extraction timed out',
        );
        if (!text) throw new Error('no extractable text found in PDF');
        const chars = await db.setPaperFullText(userId, paperId, text.slice(0, FULL_TEXT_MAX));
        console.log(`[papers] extracted ${chars} chars from ${paperId}`);
        extractionCooldown.delete(paperId);
        lastError = null;
        break;
      } catch (e) {
        lastError = e;
        // A timeout means this file can't be parsed promptly; retrying just
        // blocks every other paper behind it in the queue.
        if (e.message === 'text extraction timed out') break;
        if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 1500));
      }
    }
    if (lastError) {
      extractionCooldown.set(paperId, Date.now() + 30_000);
      console.warn(`[papers] text extraction failed for ${paperId}: ${lastError.message}`);
    }
    extractionInFlight.delete(paperId);
  }).catch(e => {
    extractionInFlight.delete(paperId);
    console.warn(`[papers] extraction job crashed for ${paperId}: ${e.message}`);
  });
}

function safeUserDir(email) {
  return String(email).replace(/[^a-z0-9_.@-]/gi, '_');
}

// Stored file paths are absolute. The same volume is mounted at different
// paths on the host (…/uploads) and in Docker (/app/uploads), and a DB moved
// between the two keeps the old prefix. Resolve by basename under the current
// UPLOAD_ROOT before declaring a cached file missing.
function resolvePaperFilePath(paper, email) {
  if (paper?.filePath && existsSync(paper.filePath)) return paper.filePath;
  if (!paper?.filePath) return null;
  const dir  = join(UPLOAD_ROOT, 'papers', safeUserDir(email));
  const name = basename(paper.filePath);
  const candidates = [
    join(dir, name),
    join(dir, `${paper.id}.pdf`),   // id-based name used by the cache route
  ];
  return candidates.find(p => existsSync(p)) ?? null;
}

function paperCachePath(req, paperId) {
  const email = String(req.get('x-user-email') || req.query.email || 'unknown');
  const dir = join(UPLOAD_ROOT, 'papers', safeUserDir(email));
  mkdirSync(dir, { recursive: true });
  return join(dir, `${paperId}.pdf`);
}

function paperFigurePath(userId, paperId, index) {
  const dir = join(UPLOAD_ROOT, 'paper-thumbnails', String(userId));
  mkdirSync(dir, { recursive: true });
  const key = createHash('sha256').update(`${paperId}:${index}`).digest('hex');
  return join(dir, `${key}.jpg`);
}

function resolvePaperFigurePath(userId, figure) {
  if (!figure?.file) return null;
  const file = basename(String(figure.file));
  if (!/^[a-f0-9]{64}\.jpg$/i.test(file)) return null;
  const path = join(UPLOAD_ROOT, 'paper-thumbnails', String(userId), file);
  return existsSync(path) ? path : null;
}

async function generatePaperFigures(userId, paper, req) {
  const meta = await db.getPaperThumbnail(userId, paper.id);
  if (meta?.checked && meta.version === FIGURE_CACHE_VERSION) {
    const figures = Array.isArray(meta.figures) ? meta.figures : [];
    if (figures.length === 0) return figures;
    if (figures.every(figure => resolvePaperFigurePath(userId, figure))) return figures;
  }

  const isArxiv = /^(\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(v\d+)?$/i.test(String(paper.arxivId ?? ''));
  const cachedPath = resolvePaperFilePath(paper, req.get('x-user-email') || '');
  let pdfBuffer = cachedPath ? readFileSync(cachedPath) : null;
  let htmlArxivId = isArxiv ? paper.arxivId : null;
  if (pdfBuffer && isArxiv && !/v\d+$/i.test(paper.arxivId)) {
    // A cached v1 PDF must never be illustrated with assets from arXiv's
    // current v2 HTML. Use the printed version, or keep the PDF as authority.
    const version = await detectArxivPdfVersion(pdfBuffer, paper.arxivId);
    htmlArxivId = version ? `${paper.arxivId}${version}` : null;
  }

  let extracted = null;
  if (htmlArxivId) {
    try {
      // LaTeXML/arXiv HTML retains the original composed SVG/PNG assets, so
      // complete multi-panel figures don't depend on fragile PDF crop bounds.
      extracted = await enqueuePdfFetch(() => createArxivHtmlFigures(htmlArxivId, { headers: ARXIV_HEADERS }));
    } catch (error) {
      console.warn(`[figures] arXiv HTML unavailable for ${htmlArxivId}: ${error.message}; using PDF`);
    }
  }

  if (!extracted || extracted.some(figure => !figure)) {
    if (!pdfBuffer && isArxiv) {
      // Reuse the shared PDF queue/rate limit. The PDF buffer is temporary: only
      // extracted figure images are retained unless the user separately caches
      // the whole PDF.
      pdfBuffer = await enqueuePdfFetch(() => downloadArxivPdf(paper.arxivId));
    } else if (!pdfBuffer) {
      await db.setPaperThumbnail(userId, paper.id, [], FIGURE_CACHE_VERSION);
      return [];
    }

    const pdfFigures = await enqueueExtraction(() => withTimeout(
      createPaperFigureThumbnails(pdfBuffer),
      180_000,
      'paper figure extraction timed out',
    ));
    // HTML and PDF figure captions follow the same sequence. Fill only missing
    // HTML groups from the PDF so a broken appendix asset never drops a figure.
    extracted = extracted
      ? extracted.map((figure, index) => figure ?? pdfFigures[index] ?? null).filter(Boolean)
      : pdfFigures;
  }

  const figures = [];
  for (let index = 0; index < extracted.length; index++) {
    const figure = extracted[index];
    const path = paperFigurePath(userId, paper.id, index);
    writeFileSync(path, figure.buffer);
    figures.push({
      index,
      pageNumber: figure.pageNumber ?? null,
      width: figure.width,
      height: figure.height,
      file: basename(path),
    });
  }

  await db.setPaperThumbnail(userId, paper.id, figures, FIGURE_CACHE_VERSION);
  return figures;
}

async function getOrGeneratePaperFigures(uid, paper, req) {
  const key = `${uid}:${paper.id}`;
  let pending = thumbnailInFlight.get(key);
  if (!pending) {
    pending = generatePaperFigures(uid, paper, req);
    thumbnailInFlight.set(key, pending);
    pending.finally(() => thumbnailInFlight.delete(key)).catch(() => {});
  }
  return pending;
}

app.post('/api/db/papers/:id/figures', (req, res) => withUser(req, res, async (uid) => {
  const paper = await db.getPaper(uid, req.params.id);
  if (!paper) return res.status(404).json({ error: 'paper not found' });
  const figures = await getOrGeneratePaperFigures(uid, paper, req);
  res.json({ figures: figures.map(({ index, pageNumber, width, height }) => ({ index, pageNumber, width, height })) });
}));

app.get('/api/db/papers/:id/figures/:index', (req, res) => withUser(req, res, async (uid) => {
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0) return res.status(400).json({ error: 'Invalid figure index.' });
  const meta = await db.getPaperThumbnail(uid, req.params.id);
  const figure = meta?.figures?.find(item => item.index === index);
  const path = resolvePaperFigurePath(uid, figure);
  if (!path) return res.status(404).json({ error: 'Paper figure not found.' });
  res.status(200)
    .type('image/jpeg')
    .set('Cache-Control', 'private, max-age=86400')
    .send(readFileSync(path));
}));

// Keep the old single-thumbnail endpoint compatible with already-open clients.
app.post('/api/db/papers/:id/thumbnail', (req, res) => withUser(req, res, async (uid) => {
  const paper = await db.getPaper(uid, req.params.id);
  if (!paper) return res.status(404).json({ error: 'paper not found' });
  const figures = await getOrGeneratePaperFigures(uid, paper, req);
  const path = resolvePaperFigurePath(uid, figures[0]);
  if (!path) return res.json({ hasImage: false });
  res.status(200)
    .type('image/jpeg')
    .set('Cache-Control', 'private, max-age=86400')
    .send(readFileSync(path));
}));

app.post('/api/db/papers/:id/cache-file', (req, res) => withUser(req, res, async (uid) => {
  const paper = await db.getPaper(uid, req.params.id);
  if (!paper) return res.status(404).json({ error: 'paper not found' });
  if (String(paper.arxivId).startsWith('local:')) {
    return res.status(400).json({ error: 'this paper has no arXiv id to download' });
  }

  // Already cached: repair a stale host/container path if needed, and make
  // sure text extraction is running if it never finished.
  const existingPath = resolvePaperFilePath(paper, req.get('x-user-email') || req.query.email);
  if (existingPath) {
    if (existingPath !== paper.filePath) {
      await db.attachFileToPaper(uid, paper.id, {
        path: existingPath,
        size: statSync(existingPath).size,
        mimetype: 'application/pdf',
        originalname: paper.originalFilename ?? `${paper.arxivId}.pdf`,
      });
    }
    if (!paper.hasFullText) scheduleTextExtraction(uid, paper.id, existingPath);
    const refreshed = existingPath !== paper.filePath ? await db.getPaper(uid, paper.id) : paper;
    return res.json({ ok: true, cached: true, textPending: !refreshed.hasFullText, paper: refreshed });
  }

  const buf = await (() => {
    // De-duplicate concurrent requests for the same paper (e.g. opening it
    // while the library warm-up is working through its queue).
    const key = paper.id;
    let pending = downloadInFlight.get(key);
    if (!pending) {
      pending = enqueuePdfFetch(() => downloadArxivPdf(paper.arxivId));
      downloadInFlight.set(key, pending);
      pending.finally(() => downloadInFlight.delete(key)).catch(() => {});
    }
    return pending;
  })();
  const filePath = paperCachePath(req, paper.id);
  writeFileSync(filePath, buf);

  await db.attachFileToPaper(uid, paper.id, {
    path: filePath,
    size: buf.length,
    mimetype: 'application/pdf',
    originalname: `${paper.arxivId}.pdf`,
  });
  const updated = await db.getPaper(uid, paper.id);
  res.json({ ok: true, cached: false, textPending: true, paper: updated });
  scheduleTextExtraction(uid, paper.id, filePath);
}));

app.get('/api/db/papers/:id/fulltext', (req, res) => withUser(req, res, async (uid) => {
  const data = await db.getPaperFullText(uid, req.params.id);
  if (!data) return res.status(404).json({ error: 'paper not found' });
  // Self-heal: the PDF is cached but text is missing (e.g. it was extracted
  // before the NUL-byte fix, or a one-off parse error). Kick off extraction
  // again so opening the paper repairs it without a manual re-cache.
  if (!data.ready && data.hasFile) {
    const paper = await db.getPaper(uid, req.params.id);
    const path  = resolvePaperFilePath(paper, req.get('x-user-email') || req.query.email);
    if (path) scheduleTextExtraction(uid, req.params.id, path);
  }
  res.json(data);
}));

// documents (Writer drafts)
app.get('/api/db/documents', (req, res) => withUser(req, res, async (uid) => {
  res.json({ documents: await db.getDocuments(uid) });
}));
app.get('/api/db/documents/:id', (req, res) => withUser(req, res, async (uid) => {
  const d = await db.getDocument(uid, req.params.id);
  if (!d) return res.status(404).json({ error: 'not found' });
  res.json({ document: d });
}));
app.put('/api/db/documents/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertDocument(uid, { ...req.body, id: req.params.id }); res.json({ ok: true });
}));
app.delete('/api/db/documents/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.deleteDocument(uid, req.params.id); res.json({ ok: true });
}));

// collections
app.get('/api/db/collections', (req, res) => withUser(req, res, async (uid) => {
  res.json({ collections: await db.getCollections(uid) });
}));
app.put('/api/db/collections/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertCollection(uid, { ...req.body, id: req.params.id });
  res.json({ ok: true });
}));
app.delete('/api/db/collections/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.deleteCollection(uid, req.params.id); res.json({ ok: true });
}));
app.post('/api/db/collections/:id/items', (req, res) => withUser(req, res, async (uid) => {
  await db.addCollectionItem(uid, { ...req.body, collectionId: req.params.id });
  res.json({ ok: true });
}));
app.patch('/api/db/collections/:id/items', (req, res) => withUser(req, res, async (uid) => {
  await db.updateCollectionItem(uid, { ...req.body, collectionId: req.params.id });
  res.json({ ok: true });
}));
app.delete('/api/db/collections/:id/items/:kind/:targetId', (req, res) => withUser(req, res, async (uid) => {
  await db.removeCollectionItem(uid, req.params.id, req.params.kind, req.params.targetId);
  res.json({ ok: true });
}));

// links (cross-references)
app.get('/api/db/links', (req, res) => withUser(req, res, async (uid) => {
  res.json({ links: await db.getLinks(uid) });
}));
app.post('/api/db/links', (req, res) => withUser(req, res, async (uid) => {
  await db.addLink(uid, req.body); res.json({ ok: true });
}));
app.delete('/api/db/links', (req, res) => withUser(req, res, async (uid) => {
  await db.deleteLink(uid, req.body); res.json({ ok: true });
}));

// Bulk migration ingest: client posts everything from IndexedDB in one shot.
// Per-row tolerance — duplicates / FK violations are skipped, not fatal.
app.post('/api/db/migrate-from-idb', (req, res) => withUser(req, res, async (uid) => {
  const { papers = [], library = [], readIds = [], trackers = [], scores = [] } = req.body;
  const counts = {
    papers: 0, papersSkipped: 0,
    library: 0, librarySkipped: 0,
    readIds: 0, trackers: 0, scores: 0,
  };
  if (papers.length) {
    const r = await db.upsertPapers(uid, papers);
    counts.papers        = r.inserted ?? papers.length;
    counts.papersSkipped = r.skipped ?? 0;
  }
  if (readIds.length)  { await db.setReadIds(uid, readIds); counts.readIds = readIds.length; }
  for (const t of trackers) { await db.upsertTracker(uid, t); counts.trackers++; }
  if (scores.length)   { await db.upsertScores(uid, scores); counts.scores = scores.length; }
  // Library last — depends on papers being present
  for (const pid of library) {
    try {
      const r = await db.savePaper(uid, pid);
      if (r?.saved || r?.reason === 'already_saved') counts.library++;
      else                                            counts.librarySkipped++;
    } catch {
      counts.librarySkipped++;
    }
  }
  res.json({ ok: true, counts });
}));

// ---------- Open Library proxy (free ISBN lookup, no key needed) ----------
app.get('/api/books/lookup', async (req, res) => {
  const isbn = String(req.query.isbn ?? '').replace(/[-\s]/g, '').trim();
  if (!isbn) return res.status(400).json({ error: 'isbn is required' });
  try {
    const r = await fetch(
      `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(isbn)}&format=json&jscmd=data`,
      { signal: AbortSignal.timeout(15_000) },
    );
    if (!r.ok) return res.status(502).json({ error: `Open Library ${r.status}` });
    const data = await r.json();
    const entry = data[`ISBN:${isbn}`];
    if (!entry) return res.status(404).json({ error: `No book found for ISBN ${isbn}` });
    res.json({
      isbn,
      title:     entry.title ?? '',
      authors:   (entry.authors ?? []).map(a => a.name),
      year:      entry.publish_date ? parseInt(String(entry.publish_date).match(/\d{4}/)?.[0] ?? '0', 10) || null : null,
      publisher: (entry.publishers ?? [])[0]?.name ?? '',
      coverUrl:  entry.cover?.medium ?? entry.cover?.large ?? null,
      sourceUrl: entry.url ?? `https://openlibrary.org/isbn/${isbn}`,
      abstract:  entry.notes ?? '',
    });
  } catch (e) {
    res.status(502).json({ error: `Lookup failed: ${e.message}` });
  }
});

// ---------- Magazine: external source proxies (cached) ----------
// These are public, no-auth (just CORS-blocked) sources. Proxying via our
// server keeps the browser happy and gives us a single in-memory cache.

app.get('/api/sources/hackernews',  async (_req, res) => {
  try { res.json({ items: await (await import('./sources.mjs')).fetchHackerNewsTop() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/sources/news',        async (_req, res) => {
  try { res.json({ items: await (await import('./sources.mjs')).fetchAINews() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/sources/huggingface', async (_req, res) => {
  try { res.json({ items: await (await import('./sources.mjs')).fetchHuggingFaceTrending() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/sources/github',      async (_req, res) => {
  try { res.json({ items: await (await import('./sources.mjs')).fetchGitHubTrending() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/api/sources/modelscope',  async (_req, res) => {
  try { res.json({ items: await (await import('./sources.mjs')).fetchModelScopeTrending() }); }
  catch (e) { res.status(502).json({ error: e.message }); }
});

// ---------- Magazine: issue CRUD ----------

app.get('/api/db/magazine', (req, res) => withUser(req, res, async (uid) => {
  res.json({ issues: await db.listMagazineIssues(uid) });
}));

app.get('/api/db/magazine/:id', (req, res) => withUser(req, res, async (uid) => {
  const issue = await db.getMagazineIssue(uid, req.params.id);
  if (!issue) return res.status(404).json({ error: 'not found' });
  res.json({ issue });
}));

app.delete('/api/db/magazine/:id', (req, res) => withUser(req, res, async (uid) => {
  await db.deleteMagazineIssue(uid, req.params.id);
  res.json({ ok: true });
}));

// Generate this week's issue. Body: { sources: [...], weekStart?: 'YYYY-MM-DD' }.
// The AI editorial is NOT generated server-side; the client does it after
// receiving the compiled draft so it can use the configured AI provider.
// The client then POSTs the finished issue (with editorial) back via the
// /api/db/magazine/:id PUT route. This way we don't need API keys on the
// server side.
app.post('/api/db/magazine/draft', (req, res) => withUser(req, res, async (uid) => {
  const { sources = ['hackernews', 'huggingface', 'github', 'modelscope'], weekStart, newsTopics } = req.body ?? {};

  // Compute the week window: the 7 days ending today (or ending weekStart+7).
  const end = new Date();
  const start = weekStart ? new Date(weekStart) : new Date(end);
  if (!weekStart) start.setDate(end.getDate() - 6);
  const weekStartIso = start.toISOString().slice(0, 10);
  const weekEndIso   = end.toISOString().slice(0, 10);

  // 1) the user's inbox papers for the week — capped at 200 to keep the
  //    JSONB issue body lean. The client will further slice to top-N by
  //    assessment score before saving.
  const inboxResult = await db.papersForWeek(uid, weekStartIso, weekEndIso, 200);

  // 2) external sources (parallel, fault-tolerant). Tailor the news query to
  //    the user's inbox categories (or an explicit override) so headlines
  //    match their field, not a hardcoded AI topic.
  const inboxCats = inboxResult.papers.flatMap(p => p.categories ?? []);
  const newsOpts = { news: buildNewsQuery(inboxCats, newsTopics) };
  const { results: sourceResults, errors: sourceErrors } = await fetchSources(sources, newsOpts);

  // 3) bump edition number
  const editionNumber = await db.nextMagazineEdition(uid);

  res.json({
    weekStart:     weekStartIso,
    weekEnd:       weekEndIso,
    editionNumber,
    sources,
    sourceErrors,
    inboxPapers:    inboxResult.papers,
    inboxTotal:     inboxResult.total,
    external:       sourceResults,
  });
}));

app.put('/api/db/magazine/:id', (req, res) => withUser(req, res, async (uid) => {
  const issue = { ...req.body, id: req.params.id };
  await db.insertMagazineIssue(uid, issue);
  res.json({ ok: true });
}));

// ---------- Global search ----------
app.get('/api/db/search', (req, res) => withUser(req, res, async (uid) => {
  const q = String(req.query.q ?? '').trim();
  if (!q || q.length < 2) return res.json({ results: [] });
  const limit = Math.min(parseInt(String(req.query.limit ?? '40'), 10) || 40, 100);
  try { res.json({ results: await db.globalSearch(uid, q, limit) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
}));

// Per-user auto-gen preferences (read + write)
app.get('/api/db/magazine/auto/prefs', (req, res) => withUser(req, res, async (uid) => {
  res.json({ prefs: await db.getUserMagazinePrefs(uid) });
}));
app.put('/api/db/magazine/auto/prefs', (req, res) => withUser(req, res, async (uid) => {
  await db.setUserMagazinePrefs(uid, req.body ?? {});
  res.json({ prefs: await db.getUserMagazinePrefs(uid) });
}));

// ---------- Magazine auto-generation worker ----------
// Polls every 5 minutes; picks users whose magazine_auto is on, today is
// their preferred ISO day-of-week, the server is past their preferred hour,
// and their last auto-run is >6 days old. For each, drafts a new issue
// (no AI editorial — the server doesn't have the user's AI credentials)
// and saves it. The next time the user opens the Magazine workspace
// they'll see the new issue and can add an editorial on-demand.
const SCHEDULER_INTERVAL_MS = 5 * 60 * 1000;
async function tickMagazineScheduler() {
  if (!db.enabled) return;
  let users = [];
  try { users = await db.dueMagazineUsers(); } catch (e) {
    console.warn('[scheduler] dueMagazineUsers failed:', e.message);
    return;
  }
  for (const u of users) {
    try {
      const end   = new Date();
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      const weekStartIso = start.toISOString().slice(0, 10);
      const weekEndIso   = end.toISOString().slice(0, 10);
      const sources       = u.sources && u.sources.length > 0 ? u.sources : ['hackernews', 'huggingface', 'github'];
      // Cap at 50 for auto-issues — there's no editorial that needs more,
      // and small JSONB payloads keep the reader snappy.
      const inboxResult   = await db.papersForWeek(u.id, weekStartIso, weekEndIso, 50);
      const inboxCats     = inboxResult.papers.flatMap(p => p.categories ?? []);
      const { results, errors } = await fetchSources(sources, { news: buildNewsQuery(inboxCats) });
      const editionNumber = await db.nextMagazineEdition(u.id);
      const id = `mag-auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await db.insertMagazineIssue(u.id, {
        id,
        weekStart:     weekStartIso,
        weekEnd:       weekEndIso,
        editionNumber,
        title:         `Week of ${new Date(weekStartIso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`,
        subtitle:      `Edition #${editionNumber} · auto-generated`,
        content:       {
          editorial:        undefined,
          inboxPapers:      inboxResult.papers,
          inboxTotalCount:  inboxResult.total,
          external:         results,
          sourceErrors:     errors,
        },
        sources,
        aiProvider:    null,
      });
      await db.markMagazineAutoRun(u.id);
      console.log(`[scheduler] generated magazine edition #${editionNumber} for ${u.email}`);
    } catch (e) {
      console.warn(`[scheduler] failed for ${u.email}:`, e.message);
    }
  }
}

// Kick off the scheduler once DB is connected (the listen handler below
// awaits db.init then starts polling). Skip in test envs by setting
// DISABLE_MAGAZINE_SCHEDULER=1.
function startMagazineScheduler() {
  if (process.env.DISABLE_MAGAZINE_SCHEDULER === '1') return;
  if (!db.enabled) return;
  console.log(`[scheduler] magazine auto-gen worker active (tick every ${SCHEDULER_INTERVAL_MS / 1000}s)`);
  setInterval(() => { tickMagazineScheduler().catch(() => {}); }, SCHEDULER_INTERVAL_MS);
  // First tick after 10s so a server restart picks up anyone who became
  // due while we were down.
  setTimeout(() => { tickMagazineScheduler().catch(() => {}); }, 10_000);
}

// Serve built frontend in production
if (isProd) {
  const distPath = join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));
}

app.listen(PORT, async () => {
  console.log(`[arxiv-server] running on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
  await db.init();
  if (db.enabled) {
    const email    = (process.env.SEED_USER_EMAIL || '').trim();
    const password = process.env.SEED_USER_PASSWORD || '';
    if (email && password) {
      try {
        const r = await db.ensureSeedUser({
          email,
          password,
          legacyEmail: process.env.SEED_LEGACY_EMAIL || '',
        });
        console.log(`[auth] owner account ready: ${r.email}${r.created ? ' (created)' : ''}${r.passwordSet ? ' (password set)' : ''}`);
      } catch (e) {
        console.error('[auth] seed account failed:', e.message);
      }
    }
    const recoveredJobs = await db.recoverInterruptedIngestJobs();
    if (recoveredJobs > 0) console.log(`[ingest] recovered ${recoveredJobs} interrupted job(s)`);
    startIngestionWorker({ db, request: arxivSearchFetch });
  }
  startMagazineScheduler();
});
