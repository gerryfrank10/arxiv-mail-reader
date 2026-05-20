-- v8: per-tracker control over how new papers get auto-scored.
--
-- 'manual'  → never auto-score (the safe default — no surprise AI calls).
-- 'keyword' → fast local keyword + seed-similarity scoring on every sync.
-- 'ai'      → AI scoring on every sync (the old behaviour; opt-in only).
--
-- Existing trackers default to 'manual' so the user reclaims control
-- after the upgrade. They can flip individual trackers to 'ai' or
-- 'keyword' from the UI, or batch-score on demand via the new
-- scripts/score-papers.mjs CLI.

ALTER TABLE trackers
  ADD COLUMN IF NOT EXISTS auto_score_mode TEXT NOT NULL DEFAULT 'manual'
    CHECK (auto_score_mode IN ('manual','keyword','ai'));

CREATE INDEX IF NOT EXISTS idx_trackers_auto_score
  ON trackers (user_id, auto_score_mode)
  WHERE auto_score_mode <> 'manual';
