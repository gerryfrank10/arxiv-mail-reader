-- Per-account IMAP settings. The JSONB value is an authenticated-encryption
-- envelope; the encryption key stays in server configuration, never in the DB.

ALTER TABLE users ADD COLUMN IF NOT EXISTS imap_config jsonb;
