-- Company or research lab behind a paper (e.g. "Google DeepMind", "NVIDIA"),
-- read from the affiliations on the PDF's first page. NULL means "checked, no
-- known company" when organization_checked_at is set, or "not read yet" when
-- it is NULL. Also applied at server startup (server/db.mjs), so existing
-- databases pick it up without a manual migration.

ALTER TABLE papers
  ADD COLUMN IF NOT EXISTS organization            text,
  ADD COLUMN IF NOT EXISTS organization_checked_at timestamptz;
