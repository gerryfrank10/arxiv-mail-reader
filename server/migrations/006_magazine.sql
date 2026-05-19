-- v6: Weekly research magazine — aggregated digests of what happened
-- this week across the user's inbox and a small set of trusted feeds
-- (Hacker News AI/ML, HuggingFace trending models, GitHub trending,
-- ModelScope). One issue per generation; the JSON body holds all
-- sections so the renderer doesn't have to re-fetch anything.

CREATE TABLE IF NOT EXISTS magazine_issues (
  id              TEXT         NOT NULL,
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start      DATE         NOT NULL,
  week_end        DATE         NOT NULL,
  edition_number  INTEGER      NOT NULL,
  title           TEXT         NOT NULL,
  subtitle        TEXT         NOT NULL DEFAULT '',
  content         JSONB        NOT NULL,
  sources         TEXT[]       NOT NULL DEFAULT '{}',
  ai_provider     TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_magazine_user_week ON magazine_issues (user_id, week_start DESC);
