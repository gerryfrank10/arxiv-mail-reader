import express from 'express';
import cors from 'cors';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { fileURLToPath } from 'url';
import { dirname, join, extname } from 'path';
import { mkdirSync, unlinkSync, existsSync, statSync } from 'fs';
import multer from 'multer';
import 'dotenv/config';
import { db } from './db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

// Bumped to handle large migration payloads (hundreds of papers with
// full abstracts). The actual ceiling for a 1000-paper migration is
// around 8-10MB; 100mb gives us comfortable headroom for any direction.
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

app.get('/api/presets', (_req, res) => res.json(PRESETS));
app.get('/api/health',  (_req, res) => res.json({ ok: true }));

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

function decodeXmlText(s) {
  return s
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractArxivAbstract(xml) {
  const m = xml.match(/<entry[\s\S]*?<summary>([\s\S]*?)<\/summary>/);
  return m ? decodeXmlText(m[1]) : null;
}

/**
 * Extract full paper metadata from arXiv Atom XML. Returns null when the
 * feed has no entry (e.g. unknown id), otherwise an object suitable for
 * direct JSON response.
 */
function extractArxivMetadata(xml, requestedId) {
  // Take the first <entry>...</entry> block
  const entryMatch = xml.match(/<entry>([\s\S]*?)<\/entry>/);
  if (!entryMatch) return null;
  const entry = entryMatch[1];

  const titleM     = entry.match(/<title>([\s\S]*?)<\/title>/);
  const summaryM   = entry.match(/<summary>([\s\S]*?)<\/summary>/);
  const publishedM = entry.match(/<published>([\s\S]*?)<\/published>/);
  const updatedM   = entry.match(/<updated>([\s\S]*?)<\/updated>/);
  const commentM   = entry.match(/<arxiv:comment[^>]*>([\s\S]*?)<\/arxiv:comment>/);
  const idM        = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<\s]+)<\/id>/);
  // Authors: <author><name>X</name></author>+
  const authors = [];
  const reAuthor = /<author>\s*<name>([\s\S]*?)<\/name>/g;
  let am;
  while ((am = reAuthor.exec(entry)) !== null) authors.push(decodeXmlText(am[1]));
  // Categories: <category term="X"/>
  const categories = [];
  const reCat = /<category[^>]*term="([^"]+)"/g;
  let cm;
  while ((cm = reCat.exec(entry)) !== null) categories.push(cm[1]);

  const published = publishedM ? publishedM[1].trim() : '';
  const dateStr = published
    ? new Date(published).toUTCString().replace(/^\w+, /, '').replace(/ GMT$/, '')
    : (updatedM ? updatedM[1].trim() : '');

  const arxivId = (idM ? idM[1] : requestedId).replace(/v\d+$/, '');

  return {
    arxivId,
    title:      titleM   ? decodeXmlText(titleM[1])   : '(untitled)',
    abstract:   summaryM ? decodeXmlText(summaryM[1]) : '',
    authorList: authors,
    categories,
    date:       dateStr,
    published,
    comments:   commentM ? decodeXmlText(commentM[1]) : '',
  };
}

async function fetchFromArxiv(id) {
  // Single throttled call (no retry — we'd rather fall back to S2 quickly)
  return arxivQueue = arxivQueue.then(async () => {
    const wait = Math.max(0, ARXIV_MIN_GAP_MS - (Date.now() - lastArxivCall));
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    lastArxivCall = Date.now();
    const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
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
  const rawId = String(req.query.id ?? '').trim();
  if (!rawId) return res.status(400).json({ error: 'id is required' });
  const id = rawId.replace(/v\d+$/i, '');

  const cached = metadataCache.get(id);
  if (cached && Date.now() - cached.ts < METADATA_TTL_MS) {
    return res.json(cached.meta);
  }
  try {
    // Reuse the throttled arXiv queue but ask for the full body
    const body = await (arxivQueue = arxivQueue.then(async () => {
      const wait = Math.max(0, ARXIV_MIN_GAP_MS - (Date.now() - lastArxivCall));
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      lastArxivCall = Date.now();
      const r = await fetch(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`);
      const text = await r.text();
      if (r.status !== 200) throw new Error(`arXiv ${r.status}`);
      return text;
    }));
    const meta = extractArxivMetadata(body, id);
    if (!meta) {
      return res.status(404).json({ error: `No entry for arXiv:${id} — check the id` });
    }
    metadataCache.set(id, { meta, ts: Date.now() });
    res.json(meta);
  } catch (err) {
    res.status(502).json({ error: `Failed to fetch from arXiv: ${err.message}` });
  }
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
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
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
  const { host, port = 993, username, password, senderEmail, maxEmails = 30 } = req.body;

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
        const parsed = await simpleParser(msg.source);
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
  // Accept the user email via header (normal API calls) OR query param
  // (direct file navigation from <a href target=_blank> where headers
  // can't be set).
  const email = req.get('x-user-email') || req.query.email;
  if (!email) return res.status(401).json({ error: 'X-User-Email header or ?email=… required' });
  try {
    const userId = await db.userIdForEmail(String(email));
    await run(userId);
  } catch (e) {
    console.error('[db] route error:', e);
    res.status(500).json({ error: e.message });
  }
}

app.get('/api/db/status', (_req, res) => res.json({ enabled: db.enabled }));

// papers
app.get('/api/db/papers', (req, res) => withUser(req, res, async (uid) => {
  res.json({ papers: await db.getPapers(uid) });
}));
app.post('/api/db/papers', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertPapers(uid, req.body.papers ?? []);
  res.json({ ok: true });
}));
app.patch('/api/db/papers/:id/abstract', (req, res) => withUser(req, res, async (uid) => {
  await db.updateAbstract(uid, req.params.id, req.body.abstract ?? '');
  res.json({ ok: true });
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

// read states
app.get('/api/db/read', (req, res) => withUser(req, res, async (uid) => {
  res.json({ ids: await db.getReadIds(uid) });
}));
app.put('/api/db/read', (req, res) => withUser(req, res, async (uid) => {
  await db.setReadIds(uid, req.body.ids ?? []); res.json({ ok: true });
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

// AI correlations cache
app.get('/api/db/correlations/:arxivId', (req, res) => withUser(req, res, async (uid) => {
  const limit    = Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100);
  const minScore = Math.min(100, Math.max(0, parseInt(String(req.query.minScore ?? '50'), 10) || 50));
  res.json({ correlations: await db.getCorrelationsForPaper(uid, req.params.arxivId, limit, minScore) });
}));
app.post('/api/db/correlations', (req, res) => withUser(req, res, async (uid) => {
  await db.upsertCorrelations(uid, req.body.correlations ?? []);
  res.json({ ok: true });
}));
app.get('/api/db/correlations-stats', (req, res) => withUser(req, res, async (uid) => {
  res.json(await db.getCorrelationStats(uid));
}));
app.post('/api/db/correlations-missing', (req, res) => withUser(req, res, async (uid) => {
  const candidates = req.body.candidates ?? [];
  const limit      = Math.min(parseInt(String(req.body.limit ?? '1'), 10) || 1, 20);
  res.json({ arxivIds: await db.findPapersMissingCorrelations(uid, candidates, limit) });
}));

// bulk migration ingest: client posts everything from IndexedDB in one shot
app.post('/api/db/migrate-from-idb', (req, res) => withUser(req, res, async (uid) => {
  const { papers = [], library = [], readIds = [], trackers = [], scores = [] } = req.body;
  // Each step is idempotent (uses ON CONFLICT) so re-running is safe
  if (papers.length)   await db.upsertPapers(uid, papers);
  if (readIds.length)  await db.setReadIds(uid, readIds);
  for (const p of library) await db.savePaper(uid, p);
  for (const t of trackers) await db.upsertTracker(uid, t);
  if (scores.length)   await db.upsertScores(uid, scores);
  res.json({
    ok: true,
    counts: {
      papers: papers.length, library: library.length, readIds: readIds.length,
      trackers: trackers.length, scores: scores.length,
    },
  });
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

// Serve built frontend in production
if (isProd) {
  const distPath = join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));
}

app.listen(PORT, async () => {
  console.log(`[arxiv-server] running on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
  await db.init();
});
