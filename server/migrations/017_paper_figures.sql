-- Store metadata for every extracted figure in a paper. Figure image files
-- remain on disk under uploads/paper-thumbnails/<user-id>/.

ALTER TABLE papers ADD COLUMN IF NOT EXISTS thumbnail_figures jsonb;
