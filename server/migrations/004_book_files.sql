-- v4: attached files for books (PDF / EPUB uploads).
--
-- File contents live on disk under ./uploads/books/<user>/<book>.<ext>;
-- this table just stores the metadata needed to serve them back.

ALTER TABLE books
  ADD COLUMN IF NOT EXISTS file_path          TEXT,
  ADD COLUMN IF NOT EXISTS file_size          BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type          TEXT,
  ADD COLUMN IF NOT EXISTS original_filename  TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_at        TIMESTAMPTZ;
