import paperFixture from './fixtures/papers-v1.json' with { type: 'json' };
import { getTerminalBenchCatalog } from './terminalBench.mjs';
import { normalizePaper } from './latexNormalize.mjs';
import { figurePath, getFiguresMeta, warmFigures } from './figures.mjs';
import { addChallenge, addComment, getEngagement, toggleLike } from './engagement.mjs';

const FIXTURE_SCOPE = 'parallax-ai-ml-papers-v1';
const MAX_FEED_SIZE = 10;

const PUBLIC_GET_PATHS = new Set([
  '/api/v1/public/feed',
  '/api/v1/public/benchmarks/terminal-bench',
]);

export function isParallaxPublicRead(req) {
  if (String(req.method).toUpperCase() !== 'GET') return false;
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  if (PUBLIC_GET_PATHS.has(path)) return true;
  if (/^\/api\/v1\/public\/papers\/[^/]+$/.test(path)) return true;
  if (/^\/api\/v1\/public\/papers\/[^/]+\/figures$/.test(path)) return true;
  if (/^\/api\/v1\/public\/papers\/[^/]+\/figures\/[^/]+$/.test(path)) return true;
  return false;
}

// Engagement writes are public (anonymous device-scoped); account APIs are not reused.
const PUBLIC_POST_RE = /^\/api\/v1\/public\/papers\/[^/]+\/(like|comments|challenges|figures\/warm)$/;

export function isParallaxPublicWrite(req) {
  if (String(req.method).toUpperCase() !== 'POST') return false;
  const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
  return PUBLIC_POST_RE.test(path);
}

function handleEngagementResult(res, result) {
  if (result && result.error) {
    res.status(result.status ?? 400).json({ error: result.error });
    return;
  }
  res.json(result);
}

export function registerParallaxPublicApi(app, { pilotFixtureEnabled = true } = {}) {
  app.get('/api/v1/public/feed', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'The fixed pilot feed is disabled in this environment.' });
    const requested = Number(req.query.limit);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(MAX_FEED_SIZE, Math.floor(requested))
      : MAX_FEED_SIZE;
    res.json({
      schemaVersion: 1,
      scope: FIXTURE_SCOPE,
      isFixture: true,
      limit,
      total: paperFixture.length,
      papers: paperFixture.slice(0, limit).map(normalizePaper),
    });
  });

  app.get('/api/v1/public/papers/:arxivId', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'The fixed pilot papers are disabled in this environment.' });
    const paper = paperFixture.find(item => item.arxivId === req.params.arxivId);
    if (!paper) return res.status(404).json({ error: 'Paper is not in the Parallax 10-paper fixture.' });
    return res.json({ schemaVersion: 1, scope: FIXTURE_SCOPE, isFixture: true, paper: normalizePaper(paper) });
  });

  // ---- Figures (lazy-extracted, cached; see figures.mjs) ----
  app.get('/api/v1/public/papers/:arxivId/figures', async (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Figure extraction is disabled in this environment.' });
    try {
      res.json(await getFiguresMeta(req.params.arxivId));
    } catch (cause) {
      res.status(500).json({ error: cause instanceof Error ? cause.message : 'figure extraction failed' });
    }
  });

  app.get('/api/v1/public/papers/:arxivId/figures/:file', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Figure extraction is disabled in this environment.' });
    const p = figurePath(req.params.arxivId, req.params.file);
    if (!p) return res.status(404).json({ error: 'Figure not found.' });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.sendFile(p);
  });

  // ---- Engagement (anonymous, device-scoped; no account data) ----
  app.get('/api/v1/public/papers/:arxivId/engagement', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Engagement is disabled in this environment.' });
    res.json(getEngagement(req.params.arxivId, req));
  });

  app.post('/api/v1/public/papers/:arxivId/like', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Engagement is disabled in this environment.' });
    handleEngagementResult(res, toggleLike(req.params.arxivId, req));
  });

  app.post('/api/v1/public/papers/:arxivId/comments', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Engagement is disabled in this environment.' });
    handleEngagementResult(res, addComment(req.params.arxivId, req));
  });

  app.post('/api/v1/public/papers/:arxivId/challenges', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Engagement is disabled in this environment.' });
    handleEngagementResult(res, addChallenge(req.params.arxivId, req));
  });

  // Prefetch hint from the feed (kicks off extraction, responds immediately).
  app.post('/api/v1/public/papers/:arxivId/figures/warm', (req, res) => {
    if (!pilotFixtureEnabled) return res.status(404).json({ error: 'Figure extraction is disabled in this environment.' });
    warmFigures(req.params.arxivId);
    res.json({ schemaVersion: 1, ok: true });
  });

  app.get('/api/v1/public/benchmarks/terminal-bench', (_req, res) => {
    res.json({ schemaVersion: 1, catalog: getTerminalBenchCatalog() });
  });
}

export { FIXTURE_SCOPE, MAX_FEED_SIZE };
