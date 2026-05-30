CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  origin_spec TEXT NOT NULL UNIQUE,
  entry_url TEXT NOT NULL,
  defaults_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

ALTER TABLE runs ADD COLUMN app_id TEXT;
CREATE INDEX IF NOT EXISTS idx_runs_app ON runs(app_id);
