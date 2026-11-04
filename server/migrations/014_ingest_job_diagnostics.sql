-- Preserve structured upstream failure details (provider, HTTP status, retry
-- waits, failed checkpoint) so users can diagnose and safely resume jobs.

ALTER TABLE ingest_jobs
  ADD COLUMN IF NOT EXISTS error_details JSONB;
