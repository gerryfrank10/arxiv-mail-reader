-- v5: AI-computed paper correlations cache.
--
-- The user's library can be 100+ papers — asking an AI provider to find
-- "what's like this paper" on every click burns tokens unnecessarily.
-- Instead a background worker pre-computes pairwise correlations and
-- caches them here; rate-limited to ~100 papers/hour so token spend is
-- predictable.
--
-- The cache is read on PaperDetail to surface "AI-correlated from your
-- library" matches instantly with no further AI calls.

CREATE TABLE IF NOT EXISTS paper_correlations (
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_arxiv_id  TEXT         NOT NULL,
  target_arxiv_id  TEXT         NOT NULL,
  score            INTEGER      NOT NULL CHECK (score BETWEEN 0 AND 100),
  rationale        TEXT         NOT NULL DEFAULT '',
  computed_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- Provider that produced this row (e.g. 'claude', 'ollama', 'openai').
  -- Used in stats and to invalidate cache when the user changes providers.
  ai_provider      TEXT         NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, source_arxiv_id, target_arxiv_id),
  -- Self-correlation makes no sense
  CHECK (source_arxiv_id <> target_arxiv_id)
);

CREATE INDEX IF NOT EXISTS idx_correlations_source ON paper_correlations (user_id, source_arxiv_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_correlations_target ON paper_correlations (user_id, target_arxiv_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_correlations_user_when ON paper_correlations (user_id, computed_at DESC);
