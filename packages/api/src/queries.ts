import type Database from 'better-sqlite3';
import type {
  ConsoleEntry,
  Edge,
  GraphPayload,
  NetworkEntry,
  PageDetail,
  PageError,
  PageState,
  Run,
  RunSummary,
} from '@testworker/shared';
import { CrawlOptions } from '@testworker/shared';

interface RunRow {
  id: string;
  start_url: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  options_json: string;
  error_message: string | null;
}

interface PageRow {
  id: string;
  run_id: string;
  url: string;
  title: string;
  signature: string;
  depth: number;
  visited_at: string;
  screenshot_path: string | null;
  viewport_w: number;
  viewport_h: number;
  error_count: number;
  console_error_count: number;
  network_error_count: number;
}

interface EdgeRow {
  id: string;
  run_id: string;
  from_page_state_id: string;
  to_page_state_id: string;
  trigger: string;
  trigger_selector: string | null;
  trigger_text: string | null;
  created_at: string;
}

function rowToRun(row: RunRow): Run {
  return {
    id: row.id,
    startUrl: row.start_url,
    status: row.status as Run['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    options: CrawlOptions.parse(JSON.parse(row.options_json)),
    errorMessage: row.error_message,
  };
}

function rowToPage(row: PageRow): PageState {
  return {
    id: row.id,
    runId: row.run_id,
    url: row.url,
    title: row.title,
    signature: row.signature,
    depth: row.depth,
    visitedAt: row.visited_at,
    screenshotPath: row.screenshot_path,
    viewport: { width: row.viewport_w, height: row.viewport_h },
    errorCount: row.error_count,
    consoleErrorCount: row.console_error_count,
    networkErrorCount: row.network_error_count,
  };
}

function rowToEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    runId: row.run_id,
    fromPageStateId: row.from_page_state_id,
    toPageStateId: row.to_page_state_id,
    trigger: row.trigger as Edge['trigger'],
    triggerSelector: row.trigger_selector,
    triggerText: row.trigger_text,
    createdAt: row.created_at,
  };
}

export function listRuns(db: Database.Database): RunSummary[] {
  const rows = db
    .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 200`)
    .all() as RunRow[];
  return rows.map((row) => {
    const run = rowToRun(row);
    const counts = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM page_states WHERE run_id = ?) AS pages,
           (SELECT COUNT(*) FROM edges WHERE run_id = ?) AS edges,
           (SELECT COALESCE(SUM(error_count + console_error_count + network_error_count), 0)
              FROM page_states WHERE run_id = ?) AS errors`,
      )
      .get(run.id, run.id, run.id) as { pages: number; edges: number; errors: number };
    return {
      run,
      pageCount: counts.pages,
      edgeCount: counts.edges,
      errorCount: counts.errors,
    };
  });
}

export function getGraph(db: Database.Database, runId: string): GraphPayload | null {
  const runRow = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
  if (!runRow) return null;
  const pages = (db.prepare(`SELECT * FROM page_states WHERE run_id = ?`).all(runId) as PageRow[]).map(
    rowToPage,
  );
  const edges = (db.prepare(`SELECT * FROM edges WHERE run_id = ?`).all(runId) as EdgeRow[]).map(
    rowToEdge,
  );
  return { run: rowToRun(runRow), pages, edges };
}

export function getPageDetail(
  db: Database.Database,
  pageStateId: string,
): PageDetail | null {
  const pageRow = db
    .prepare(`SELECT * FROM page_states WHERE id = ?`)
    .get(pageStateId) as PageRow | undefined;
  if (!pageRow) return null;
  const page = rowToPage(pageRow);
  const consoleRows = db
    .prepare(`SELECT * FROM console_entries WHERE page_state_id = ? ORDER BY timestamp`)
    .all(pageStateId) as Array<{
    id: string;
    page_state_id: string;
    level: string;
    text: string;
    url: string | null;
    line_number: number | null;
    timestamp: string;
  }>;
  const consoleEntries: ConsoleEntry[] = consoleRows.map((r) => ({
    id: r.id,
    pageStateId: r.page_state_id,
    level: r.level as ConsoleEntry['level'],
    text: r.text,
    url: r.url,
    lineNumber: r.line_number,
    timestamp: r.timestamp,
  }));
  const networkRows = db
    .prepare(`SELECT * FROM network_entries WHERE page_state_id = ? ORDER BY started_at`)
    .all(pageStateId) as Array<{
    id: string;
    page_state_id: string;
    method: string;
    url: string;
    status: number | null;
    status_text: string | null;
    resource_type: string;
    started_at: string;
    duration_ms: number | null;
    from_cache: number;
    failed: number;
    failure_text: string | null;
  }>;
  const network: NetworkEntry[] = networkRows.map((r) => ({
    id: r.id,
    pageStateId: r.page_state_id,
    method: r.method,
    url: r.url,
    status: r.status,
    statusText: r.status_text,
    resourceType: r.resource_type,
    startedAt: r.started_at,
    durationMs: r.duration_ms,
    fromCache: Boolean(r.from_cache),
    failed: Boolean(r.failed),
    failureText: r.failure_text,
  }));
  const errorRows = db
    .prepare(`SELECT * FROM page_errors WHERE page_state_id = ? ORDER BY timestamp`)
    .all(pageStateId) as Array<{
    id: string;
    page_state_id: string;
    kind: string;
    message: string;
    stack: string | null;
    timestamp: string;
  }>;
  const errors: PageError[] = errorRows.map((r) => ({
    id: r.id,
    pageStateId: r.page_state_id,
    kind: r.kind as PageError['kind'],
    message: r.message,
    stack: r.stack,
    timestamp: r.timestamp,
  }));
  const incoming = (
    db
      .prepare(`SELECT * FROM edges WHERE to_page_state_id = ?`)
      .all(pageStateId) as EdgeRow[]
  ).map(rowToEdge);
  const outgoing = (
    db
      .prepare(`SELECT * FROM edges WHERE from_page_state_id = ?`)
      .all(pageStateId) as EdgeRow[]
  ).map(rowToEdge);
  return { page, console: consoleEntries, network, errors, incoming, outgoing };
}
