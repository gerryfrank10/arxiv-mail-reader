-- Durable, resumable source-ingestion jobs. The source-specific config is
-- versioned JSON; progress is checkpointed after each committed result page.

CREATE TABLE IF NOT EXISTS ingest_jobs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_id        TEXT         NOT NULL,
  config           JSONB        NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled')),
  slice_index      INTEGER      NOT NULL DEFAULT 0,
  page_start       INTEGER      NOT NULL DEFAULT 0,
  total_slices     INTEGER      NOT NULL DEFAULT 0,
  current_slice    TEXT         NOT NULL DEFAULT '',
  papers_found     BIGINT       NOT NULL DEFAULT 0,
  papers_added     BIGINT       NOT NULL DEFAULT 0,
  papers_skipped   BIGINT       NOT NULL DEFAULT 0,
  error            TEXT,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_user_recent
  ON ingest_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_jobs_worker
  ON ingest_jobs (status, created_at ASC)
  WHERE status IN ('queued', 'running');
