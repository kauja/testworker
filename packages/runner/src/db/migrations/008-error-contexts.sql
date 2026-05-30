CREATE TABLE IF NOT EXISTS error_contexts (
  error_id TEXT PRIMARY KEY REFERENCES page_errors(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL,
  dom_ref TEXT,
  screenshot_ref TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_contexts_created ON error_contexts(created_at);
