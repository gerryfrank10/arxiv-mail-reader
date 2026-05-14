import express from 'express';
import cors from 'cors';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === 'production';

app.use(express.json());
if (!isProd) {
  // In dev the Vite proxy handles CORS; in prod everything is same-origin
  app.use(cors({ origin: ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
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

function extractArxivAbstract(xml) {
  // Look for <summary>...</summary> inside an <entry>. The Atom feed has a
  // top-level <title> but no top-level <summary>, so a single grep is safe.
  const m = xml.match(/<entry[\s\S]*?<summary>([\s\S]*?)<\/summary>/);
  if (!m) return null;
  return m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
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
    // Retry on 429 with backoff: 3s, 8s, 20s
    const BACKOFFS = [3000, 8000, 20000];
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
      throw new Error(`S2 ${r.status}: ${text.slice(0, 140)}`);
    }
    const data = await r.json();
    s2Cache.set(pathWithQuery, { data, ts: Date.now() });
    return data;
  }).catch(err => { throw err; });
}

// Pull optional S2 key from request header so the client can pass through a
// user-supplied key from Settings without exposing it on the server.
function s2KeyFrom(req) {
  return req.get('x-s2-api-key') || process.env.SEMANTIC_SCHOLAR_API_KEY || undefined;
}

// GET /api/s2/search?q=world+models&limit=100
app.get('/api/s2/search', async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'q is required' });
  const limit = Math.min(Number(req.query.limit) || 100, 100);
  const params = new URLSearchParams({ query: q, limit: String(limit), fields: S2_PAPER_FIELDS });
  try {
    const data = await s2Get(`/graph/v1/paper/search?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
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
    fields: ['contexts', 'intents', 'isInfluential', 'citedPaper.' + S2_PAPER_FIELDS.split(',').join(',citedPaper.')].join(','),
  });
  // The S2 API expects fields prefixed per nested object; the simpler form below works too:
  params.set('fields', 'contexts,intents,isInfluential,' + S2_PAPER_FIELDS.split(',').map(f => `citedPaper.${f}`).join(','));
  try {
    const data = await s2Get(`/graph/v1/paper/${encodeURIComponent(id)}/references?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// GET /api/s2/paper/:id/citations
app.get('/api/s2/paper/:id/citations', async (req, res) => {
  const id = normalizePaperId(req.params.id);
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const params = new URLSearchParams({
    limit: String(limit),
    fields: 'contexts,intents,isInfluential,' + S2_PAPER_FIELDS.split(',').map(f => `citingPaper.${f}`).join(','),
  });
  try {
    const data = await s2Get(`/graph/v1/paper/${encodeURIComponent(id)}/citations?${params}`, s2KeyFrom(req));
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

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

// Serve built frontend in production
if (isProd) {
  const distPath = join(__dirname, '../dist');
  app.use(express.static(distPath));
  app.get('*', (_req, res) => res.sendFile(join(distPath, 'index.html')));
}

app.listen(PORT, () => {
  console.log(`[arxiv-server] running on http://localhost:${PORT} (${isProd ? 'production' : 'development'})`);
});
