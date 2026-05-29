CREATE TABLE IF NOT EXISTS screens (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  pathname TEXT NOT NULL,
  title TEXT NOT NULL,
  nav_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_screens_run ON screens(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_screens_run_nav_hash ON screens(run_id, nav_hash);

CREATE TABLE IF NOT EXISTS screen_states (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
  structure_hash TEXT NOT NULL,
  arrival_trigger TEXT,
  arrival_selector TEXT
);
CREATE INDEX IF NOT EXISTS idx_screen_states_run ON screen_states(run_id);
CREATE INDEX IF NOT EXISTS idx_screen_states_screen ON screen_states(screen_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_screen_states_run_screen_structure
  ON screen_states(run_id, screen_id, structure_hash);

INSERT OR IGNORE INTO screens (id, run_id, url, pathname, title, nav_hash)
SELECT
  'sc_' || lower(hex(randomblob(8))) AS id,
  run_id,
  url,
  url AS pathname,
  title,
  'legacy:' || signature AS nav_hash
FROM page_states;

INSERT OR IGNORE INTO screen_states (
  id, run_id, screen_id, structure_hash, arrival_trigger, arrival_selector
)
SELECT
  p.id,
  p.run_id,
  s.id,
  p.signature,
  'initial',
  NULL
FROM page_states p
JOIN screens s
  ON s.run_id = p.run_id
 AND s.nav_hash = 'legacy:' || p.signature;

ALTER TABLE edges ADD COLUMN kind TEXT;
ALTER TABLE edges ADD COLUMN from_state_id TEXT;
ALTER TABLE edges ADD COLUMN to_state_id TEXT;

UPDATE edges
SET
  kind = COALESCE(kind, 'nav'),
  from_state_id = COALESCE(from_state_id, from_page_state_id),
  to_state_id = COALESCE(to_state_id, to_page_state_id);

CREATE INDEX IF NOT EXISTS idx_edges_from_state ON edges(from_state_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_state ON edges(to_state_id);
