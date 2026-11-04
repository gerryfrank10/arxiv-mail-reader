-- Email + password accounts and login sessions.
--
-- Passwords are scrypt hashes produced by server/auth.mjs (format
-- `scrypt$<salt>$<key>`). Session tokens are opaque random strings; only their
-- SHA-256 hash is stored here so a DB leak can't be replayed as a login.
--
-- These statements also run at server startup (server/db.mjs), so existing
-- deployments without a fresh volume still get them.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT        PRIMARY KEY,
  user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
