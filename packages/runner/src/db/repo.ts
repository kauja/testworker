import type { Db } from './client.js';
import type {
  ArrivalTrigger,
  ConsoleEntry,
  Edge,
  EdgeKind,
  NetworkEntry,
  PageError,
  PageState,
  Run,
  Screen,
  ScreenState,
} from '@testworker/shared';

export function insertRun(db: Db, run: Run): void {
  const stmt = db.$sqlite.prepare(`
    INSERT INTO runs (
      id, start_url, status, started_at, finished_at, options_json, error_message,
      pages_done, queue_size, current_url, har_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    run.harPath,
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

/**
 * HAR (Playwright が context.close() で flush) のパスを runs に紐付ける。
 * 失敗 run でも部分的に保存される可能性があるので caller が判断して呼ぶ。
 */
export function updateRunHarPath(db: Db, runId: string, harPath: string | null): void {
  db.$sqlite.prepare(`UPDATE runs SET har_path = ? WHERE id = ?`).run(harPath, runId);
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

export function upsertScreen(db: Db, screen: Screen): void {
  const stmt = db.$sqlite.prepare(`
    INSERT INTO screens (id, run_id, url, pathname, title, nav_hash)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, nav_hash) DO UPDATE SET
      url = excluded.url,
      pathname = excluded.pathname,
      title = excluded.title
  `);
  stmt.run(screen.id, screen.runId, screen.url, screen.pathname, screen.title, screen.navHash);
}

export function upsertScreenState(db: Db, state: ScreenState): void {
  const stmt = db.$sqlite.prepare(`
    INSERT INTO screen_states (
      id, run_id, screen_id, structure_hash, arrival_trigger, arrival_selector
    ) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id, screen_id, structure_hash) DO UPDATE SET
      arrival_trigger = COALESCE(screen_states.arrival_trigger, excluded.arrival_trigger),
      arrival_selector = COALESCE(screen_states.arrival_selector, excluded.arrival_selector)
  `);
  stmt.run(
    state.id,
    state.runId,
    state.screenId,
    state.structureHash,
    state.arrivalTrigger,
    state.arrivalSelector,
  );
}

export function findScreenByNavHash(
  db: Db,
  runId: string,
  navHash: string,
): { id: string } | undefined {
  return db.$sqlite
    .prepare(`SELECT id FROM screens WHERE run_id = ? AND nav_hash = ?`)
    .get(runId, navHash) as { id: string } | undefined;
}

export function findScreenStateByIdentity(
  db: Db,
  runId: string,
  navHash: string,
  structureHash: string,
): { id: string; screenId: string } | undefined {
  return db.$sqlite
    .prepare(
      `SELECT st.id, st.screen_id AS screenId
       FROM screen_states st
       JOIN screens sc ON sc.id = st.screen_id
       WHERE st.run_id = ? AND sc.nav_hash = ? AND st.structure_hash = ?`,
    )
    .get(runId, navHash, structureHash) as { id: string; screenId: string } | undefined;
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
      id, run_id, from_page_state_id, to_page_state_id, kind, from_state_id, to_state_id, trigger,
      trigger_selector, trigger_text, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    edge.id,
    edge.runId,
    edge.fromPageStateId,
    edge.toPageStateId,
    edge.kind,
    edge.fromStateId,
    edge.toStateId,
    edge.trigger,
    edge.triggerSelector,
    edge.triggerText,
    edge.createdAt,
  );
}

export function edgeKindForScreens(fromScreenId: string, toScreenId: string): EdgeKind {
  return fromScreenId === toScreenId ? 'state' : 'nav';
}

export function arrivalTriggerFromNavigation(trigger: Edge['trigger']): ArrivalTrigger {
  switch (trigger) {
    case 'initial':
      return 'initial';
    case 'form-submit':
      return 'submit';
    default:
      return 'click';
  }
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
