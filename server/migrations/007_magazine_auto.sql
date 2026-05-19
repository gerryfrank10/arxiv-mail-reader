-- v7: opt-in weekly auto-generation of Magazine issues per user.
--
-- The scheduler in server/index.mjs checks every 5 min: if a user has
-- magazine_auto = true AND it's their preferred day-of-week AND their
-- last auto-run was >6 days ago, a new issue is generated for them
-- (raw data only — no AI editorial, since the server doesn't have the
-- user's AI credentials).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS magazine_auto             BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS magazine_day_of_week      SMALLINT    NOT NULL DEFAULT 1, -- 1 = Monday (ISO)
  ADD COLUMN IF NOT EXISTS magazine_hour             SMALLINT    NOT NULL DEFAULT 9,  -- 0..23 local server time
  ADD COLUMN IF NOT EXISTS magazine_sources          TEXT[]      NOT NULL DEFAULT '{hackernews,huggingface,github}',
  ADD COLUMN IF NOT EXISTS magazine_last_auto_run    TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_users_magazine_auto ON users (magazine_auto) WHERE magazine_auto IS TRUE;
