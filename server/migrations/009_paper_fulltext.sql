-- v9: cache the actual paper documents (PDF) + extracted full text.
--
-- File bytes live on disk under ./uploads/papers/<user>/<paper>.<ext>; the
-- papers row stores the file metadata (file_path, file_size, mime_type,
-- original_filename, uploaded_at — added in v1's runner) and the extracted
-- plain text used for search + AI. The papers list endpoint deliberately
-- never returns full_text itself (it can be megabytes per row); clients fetch
-- it per paper via /api/db/papers/:id/fulltext.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS file_path         TEXT,
  ADD COLUMN IF NOT EXISTS file_size         BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type         TEXT,
  ADD COLUMN IF NOT EXISTS original_filename TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS full_text         TEXT,
  ADD COLUMN IF NOT EXISTS full_text_chars   INTEGER,
  ADD COLUMN IF NOT EXISTS full_text_at      TIMESTAMPTZ;

-- Fast "which papers already have a cached document?" lookups.
CREATE INDEX IF NOT EXISTS idx_papers_user_file
  ON papers (user_id)
  WHERE file_path IS NOT NULL;
