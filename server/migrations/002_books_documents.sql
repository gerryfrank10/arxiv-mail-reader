-- v2: Books and Writer documents.
--
-- Books are first-class objects in the research workspace alongside
-- papers — they can be cited from the Writer, cross-referenced via the
-- notes table, and have their own notes attached.
--
-- Documents are the user's own Writer drafts. They reference papers
-- (by arXiv id) and books (by book id) via array columns; the actual
-- graph table comes in a later migration when we add cross-references.

CREATE TABLE IF NOT EXISTS books (
  id           TEXT         NOT NULL,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT         NOT NULL,
  authors      TEXT[]       NOT NULL DEFAULT '{}',
  isbn         TEXT,
  year         INTEGER,
  publisher    TEXT,
  cover_url    TEXT,
  abstract     TEXT         NOT NULL DEFAULT '',
  notes        TEXT         NOT NULL DEFAULT '',
  source_url   TEXT,
  tags         TEXT[]       NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_books_user_updated ON books (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_books_user_isbn    ON books (user_id, isbn) WHERE isbn IS NOT NULL;

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT         NOT NULL,
  user_id       UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT         NOT NULL DEFAULT 'Untitled',
  content       TEXT         NOT NULL DEFAULT '',
  paper_refs    TEXT[]       NOT NULL DEFAULT '{}',  -- arxiv ids the document cites
  book_refs     TEXT[]       NOT NULL DEFAULT '{}',  -- book ids the document cites
  tags          TEXT[]       NOT NULL DEFAULT '{}',
  status        TEXT         NOT NULL DEFAULT 'draft',  -- draft | in_review | published
  word_count    INTEGER      NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_documents_user_updated ON documents (user_id, updated_at DESC);

-- Notes can attach to any entity. We don't FK the target_id because it
-- could point to papers, books, or documents — the application enforces
-- correctness.
CREATE TABLE IF NOT EXISTS notes (
  id           TEXT         NOT NULL,
  user_id      UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_kind  TEXT         NOT NULL CHECK (target_kind IN ('paper','book','document')),
  target_id    TEXT         NOT NULL,
  body         TEXT         NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS idx_notes_target ON notes (user_id, target_kind, target_id);
