-- Cache a small first-page image preview for papers whose first page contains
-- an embedded image. The original PDF is not retained just for this preview.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS thumbnail_path        TEXT,
  ADD COLUMN IF NOT EXISTS thumbnail_checked_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS thumbnail_has_image   BOOLEAN;
