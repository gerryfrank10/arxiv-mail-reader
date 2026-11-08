-- Track the figure extraction format so old isolated-image thumbnails are
-- regenerated as captioned, rendered PDF figure crops.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS thumbnail_version integer NOT NULL DEFAULT 0;
