-- Per-paper comments shown in the dashboard feed.
--
-- Comments are scoped to their author's account: each user sees and writes
-- only their own notes on a paper, even when several accounts hold the same
-- arXiv id. Also created at server startup (server/db.mjs) so existing
-- deployments get it without a fresh volume.

CREATE TABLE IF NOT EXISTS paper_comments (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id   TEXT         NOT NULL,
  body       TEXT         NOT NULL,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_paper_comments_user_paper
  ON paper_comments (user_id, paper_id, created_at);
