-- arxiv-mail-reader v1 schema.
--
-- Owned per-user: users are identified by their email address (from Gmail
-- OAuth or IMAP). Everything cascades from `users` so dropping a user
-- removes all of their data.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT         NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS papers (
  id              TEXT         NOT NULL,        -- client-generated paper id
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  arxiv_id        TEXT         NOT NULL,
  title           TEXT         NOT NULL,
  authors         TEXT         NOT NULL DEFAULT '',
  author_list     TEXT[]       NOT NULL DEFAULT '{}',
  categories      TEXT[]       NOT NULL DEFAULT '{}',
  abstract        TEXT         NOT NULL DEFAULT '',
  comments        TEXT         NOT NULL DEFAULT '',
  url             TEXT         NOT NULL DEFAULT '',
  pdf_url         TEXT         NOT NULL DEFAULT '',
  size            TEXT         NOT NULL DEFAULT '',
  date            TEXT         NOT NULL DEFAULT '',
  email_id        TEXT         NOT NULL DEFAULT '',
  digest_subject  TEXT         NOT NULL DEFAULT '',
  digest_date     TIMESTAMPTZ  NOT NULL,
  source          TEXT         NOT NULL DEFAULT 'email',  -- 'email' | 'import' | 'bibtex'
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id),
  UNIQUE      (user_id, arxiv_id)
);

CREATE INDEX IF NOT EXISTS idx_papers_user_digestdate ON papers (user_id, digest_date DESC);
CREATE INDEX IF NOT EXISTS idx_papers_user_arxivid    ON papers (user_id, arxiv_id);

-- Per-user library (saved papers)
CREATE TABLE IF NOT EXISTS library (
  user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id  TEXT         NOT NULL,
  saved_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id),
  FOREIGN KEY (user_id, paper_id) REFERENCES papers (user_id, id) ON DELETE CASCADE
);

-- Per-user read state
CREATE TABLE IF NOT EXISTS read_states (
  user_id   UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id  TEXT         NOT NULL,
  read_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id)
);

-- Trackers
CREATE TABLE IF NOT EXISTS trackers (
  id              TEXT         NOT NULL,
  user_id         UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT         NOT NULL,
  description     TEXT         NOT NULL DEFAULT '',
  keywords        TEXT[]       NOT NULL DEFAULT '{}',
  seed_arxiv_ids  TEXT[]       NOT NULL DEFAULT '{}',
  enabled         BOOLEAN      NOT NULL DEFAULT TRUE,
  color           TEXT         NOT NULL DEFAULT 'blue',
  min_score       INTEGER      NOT NULL DEFAULT 60,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

-- Paper-vs-tracker scores
CREATE TABLE IF NOT EXISTS paper_scores (
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_id    TEXT         NOT NULL,
  tracker_id  TEXT         NOT NULL,
  score       INTEGER      NOT NULL CHECK (score >= 0 AND score <= 100),
  rationale   TEXT         NOT NULL DEFAULT '',
  source      TEXT         NOT NULL DEFAULT 'keyword',  -- 'claude' | 'keyword' (legacy label for AI scoring)
  ts          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, paper_id, tracker_id),
  FOREIGN KEY (user_id, tracker_id) REFERENCES trackers (user_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scores_user_tracker_score
  ON paper_scores (user_id, tracker_id, score DESC);
