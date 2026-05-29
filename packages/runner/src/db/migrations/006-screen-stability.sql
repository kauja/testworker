CREATE TABLE IF NOT EXISTS screen_stability (
  origin TEXT NOT NULL,
  screen_nav_hash TEXT NOT NULL,
  score REAL NOT NULL,
  sample_count INTEGER NOT NULL,
  distinct_hash_count INTEGER NOT NULL,
  threshold REAL NOT NULL,
  flaky INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (origin, screen_nav_hash)
);

CREATE INDEX IF NOT EXISTS idx_screen_stability_nav_hash
  ON screen_stability(screen_nav_hash);
