import { openDb } from './client.js';
import { loadRunnerEnv } from '../config.js';

const DDL = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  start_url TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  options_json TEXT NOT NULL,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS page_states (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  signature TEXT NOT NULL,
  depth INTEGER NOT NULL,
  visited_at TEXT NOT NULL,
  screenshot_path TEXT,
  viewport_w INTEGER NOT NULL,
  viewport_h INTEGER NOT NULL,
  error_count INTEGER NOT NULL DEFAULT 0,
  console_error_count INTEGER NOT NULL DEFAULT 0,
  network_error_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_page_states_run ON page_states(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_page_states_run_signature ON page_states(run_id, signature);

CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
  to_page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL,
  trigger_selector TEXT,
  trigger_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_edges_run ON edges(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_edges_pair_trigger
  ON edges(run_id, from_page_state_id, to_page_state_id, trigger, COALESCE(trigger_selector, ''));

CREATE TABLE IF NOT EXISTS console_entries (
  id TEXT PRIMARY KEY,
  page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
  level TEXT NOT NULL,
  text TEXT NOT NULL,
  url TEXT,
  line_number INTEGER,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_console_page ON console_entries(page_state_id);

CREATE TABLE IF NOT EXISTS network_entries (
  id TEXT PRIMARY KEY,
  page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  url TEXT NOT NULL,
  status INTEGER,
  status_text TEXT,
  resource_type TEXT NOT NULL,
  started_at TEXT NOT NULL,
  duration_ms INTEGER,
  from_cache INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  failure_text TEXT
);
CREATE INDEX IF NOT EXISTS idx_network_page ON network_entries(page_state_id);

CREATE TABLE IF NOT EXISTS page_errors (
  id TEXT PRIMARY KEY,
  page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  stack TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errors_page ON page_errors(page_state_id);
`;

export function migrate(dbPath: string): void {
  const db = openDb(dbPath);
  db.$sqlite.exec(DDL);
  db.close();
}

function main(): void {
  const env = loadRunnerEnv();
  migrate(env.dbPath);
  console.log(`[testworker] migrated: ${env.dbPath}`);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main();
}
