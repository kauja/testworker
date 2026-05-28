import type { Db } from './client.js';
import type {
  ConsoleEntry,
  Edge,
  NetworkEntry,
  PageError,
  PageState,
  Run,
} from '@testworker/shared';

export function insertRun(db: Db, run: Run): void {
  const stmt = db.$sqlite.prepare(`
    INSERT INTO runs (
      id, start_url, status, started_at, finished_at, options_json, error_message,
      pages_done, queue_size, current_url
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    run.id,
    run.startUrl,
    run.status,
    run.startedAt,
    run.finishedAt,
    JSON.stringify(run.options),
    run.errorMessage,
    run.pagesDone,
    run.queueSize,
    run.currentUrl,
  );
}

export function updateRunStatus(
  db: Db,
  runId: string,
  status: Run['status'],
  finishedAt: string | null,
  errorMessage: string | null,
): void {
  const stmt = db.$sqlite.prepare(
    `UPDATE runs SET status = ?, finished_at = ?, error_message = ? WHERE id = ?`,
  );
  stmt.run(status, finishedAt, errorMessage, runId);
}

/**
 * 走行中の進捗を runs テーブルに書き戻す (Issue #86)。
 *   - `pages_done`: snapshot 完了したページ数 (revisit は加算しない側で揃える)。
 *   - `queue_size`: frontier に残っている URL 数。
 *   - `current_url`: 今 navigate しようとしている URL。
 * BFS ループの先頭で 1 ページごとに呼ぶ想定なので軽い UPDATE 1 本。
 */
export function updateRunProgress(
  db: Db,
  runId: string,
  pagesDone: number,
  queueSize: number,
  currentUrl: string | null,
): void {
  const stmt = db.$sqlite.prepare(
    `UPDATE runs SET pages_done = ?, queue_size = ?, current_url = ? WHERE id = ?`,
  );
  stmt.run(pagesDone, queueSize, currentUrl, runId);
}

export function upsertPageState(db: Db, page: PageState): void {
  const stmt = db.$sqlite.prepare(`
    INSERT INTO page_states (
      id, run_id, url, title, signature, depth, visited_at, screenshot_path,
      viewport_w, viewport_h, error_count, console_error_count, network_error_count, metrics_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, signature) DO UPDATE SET
      title = excluded.title,
      screenshot_path = excluded.screenshot_path,
      metrics_json = excluded.metrics_json,
      error_count = page_states.error_count + excluded.error_count,
      console_error_count = page_states.console_error_count + excluded.console_error_count,
      network_error_count = page_states.network_error_count + excluded.network_error_count
  `);
  stmt.run(
    page.id,
    page.runId,
    page.url,
    page.title,
    page.signature,
    page.depth,
    page.visitedAt,
    page.screenshotPath,
    page.viewport.width,
    page.viewport.height,
    page.errorCount,
    page.consoleErrorCount,
    page.networkErrorCount,
    JSON.stringify(page.metrics ?? {}),
  );
}

export function findPageStateBySignature(
  db: Db,
  runId: string,
  signature: string,
): { id: string } | undefined {
  const row = db.$sqlite
    .prepare(`SELECT id FROM page_states WHERE run_id = ? AND signature = ?`)
    .get(runId, signature) as { id: string } | undefined;
  return row;
}

export function insertEdge(db: Db, edge: Edge): void {
  const stmt = db.$sqlite.prepare(`
    INSERT OR IGNORE INTO edges (
      id, run_id, from_page_state_id, to_page_state_id, trigger,
      trigger_selector, trigger_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    edge.id,
    edge.runId,
    edge.fromPageStateId,
    edge.toPageStateId,
    edge.trigger,
    edge.triggerSelector,
    edge.triggerText,
    edge.createdAt,
  );
}

export function insertConsoleBatch(db: Db, entries: ConsoleEntry[]): void {
  if (entries.length === 0) return;
  const stmt = db.$sqlite.prepare(`
    INSERT INTO console_entries (id, page_state_id, level, text, url, line_number, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.$sqlite.transaction((rows: ConsoleEntry[]) => {
    for (const r of rows)
      stmt.run(r.id, r.pageStateId, r.level, r.text, r.url, r.lineNumber, r.timestamp);
  });
  tx(entries);
}

export function insertNetworkBatch(db: Db, entries: NetworkEntry[]): void {
  if (entries.length === 0) return;
  const stmt = db.$sqlite.prepare(`
    INSERT INTO network_entries (
      id, page_state_id, method, url, status, status_text, resource_type,
      started_at, duration_ms, from_cache, failed, failure_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.$sqlite.transaction((rows: NetworkEntry[]) => {
    for (const r of rows)
      stmt.run(
        r.id,
        r.pageStateId,
        r.method,
        r.url,
        r.status,
        r.statusText,
        r.resourceType,
        r.startedAt,
        r.durationMs,
        r.fromCache ? 1 : 0,
        r.failed ? 1 : 0,
        r.failureText,
      );
  });
  tx(entries);
}

export function insertErrorBatch(db: Db, entries: PageError[]): void {
  if (entries.length === 0) return;
  const stmt = db.$sqlite.prepare(`
    INSERT INTO page_errors (id, page_state_id, kind, message, stack, timestamp)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const tx = db.$sqlite.transaction((rows: PageError[]) => {
    for (const r of rows) stmt.run(r.id, r.pageStateId, r.kind, r.message, r.stack, r.timestamp);
  });
  tx(entries);
}
