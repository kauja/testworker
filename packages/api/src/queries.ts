import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type {
  ConsoleEntry,
  Edge,
  ErrorGroup,
  GraphPayload,
  NetworkEntry,
  PageDetail,
  PageError,
  PageMetrics,
  PageState,
  Run,
  RunDiff,
  RunDiffPage,
  RunErrorsPayload,
  RunNetworkError,
  RunSummary,
  Screen,
  ScreenState,
  ScreenStability,
  StateGraphPayload,
  RunConsoleError,
} from '@testworker/shared';
import { CrawlOptions, PageMetrics as PageMetricsSchema, log } from '@testworker/shared';

interface RunRow {
  id: string;
  start_url: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  options_json: string;
  error_message: string | null;
  /**
   * Issue #86 で追加。 migration 002 以前に挿入された行は SELECT 時に
   * DEFAULT 0 / NULL で埋まる。 better-sqlite3 から column 自体が
   * 抜けるケース (古い DB ファイル) では undefined になるため lenient に扱う。
   */
  pages_done: number | null;
  queue_size: number | null;
  current_url: string | null;
  /** HAR ファイルへの DATA_DIR 相対パス (Issue #87)。 旧 run / 失敗 run では null。 */
  har_path: string | null;
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
  metrics_json: string | null;
}

interface EdgeRow {
  id: string;
  run_id: string;
  from_page_state_id: string;
  to_page_state_id: string;
  kind?: string | null;
  from_state_id?: string | null;
  to_state_id?: string | null;
  trigger: string;
  trigger_selector: string | null;
  trigger_text: string | null;
  created_at: string;
}

interface ScreenRow {
  id: string;
  run_id: string;
  url: string;
  pathname: string;
  title: string;
  nav_hash: string;
}

interface ScreenStateRow {
  id: string;
  run_id: string;
  screen_id: string;
  structure_hash: string;
  arrival_trigger: string | null;
  arrival_selector: string | null;
}

interface PageV2Meta {
  screenId: string;
  navHash: string;
  structureHash: string;
  stability: ScreenStability | null;
}

export interface StabilityOptions {
  origin?: string;
  windowSize?: number;
  threshold?: number;
}

const DEFAULT_STABILITY_WINDOW = 5;
const DEFAULT_STABILITY_THRESHOLD = 0.5;

// 各 field を個別に safeParse し、 valid なものだけ拾う。 1 field が invalid なときに
// 他の有効な field まで defaults に倒すのを防ぐ (Issue #66)。
export function pickValidOptionFields(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(CrawlOptions.shape)) {
    if (!(key in raw)) continue;
    const parsed = fieldSchema.safeParse(raw[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out;
}

export function rowToRun(row: RunRow): Run {
  // disk corruption / 部分書き込み等で options_json が壊れていても /runs は落とさない。
  let raw: unknown = {};
  try {
    raw = JSON.parse(row.options_json);
  } catch (err) {
    log.warn({ runId: row.id, err: (err as Error).message }, 'options_json JSON.parse failed');
  }
  // raw に startUrl が無い古い形式でも row.start_url で確実に補完する。
  const merged: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? { ...(raw as Record<string, unknown>) } : {};
  if (typeof merged.startUrl !== 'string') merged.startUrl = row.start_url;
  const parsed = CrawlOptions.safeParse(merged);
  let options: CrawlOptions;
  if (parsed.success) {
    options = parsed.data;
  } else {
    log.warn({ runId: row.id, issues: parsed.error.flatten() }, 'options_json schema mismatch');
    // field-by-field の救済: invalid な 1 field のせいで maxDepth / viewport / patterns 等
    // 他の正当な user-set 値を defaults で塗り潰すのを防ぐ。
    const validFields = pickValidOptionFields(merged);
    if (typeof validFields.startUrl !== 'string') validFields.startUrl = row.start_url;
    const repaired = CrawlOptions.safeParse(validFields);
    if (repaired.success) {
      options = repaired.data;
    } else {
      // 最終救済: startUrl が url() を満たさない (legacy scheme なし URL) などで
      // CrawlOptions.parse は依然 throw する。 手書き defaults と merge して
      // startUrl を生のまま保持する (UI 側でどのみち string として表示するだけ)。
      options = {
        ...validFields,
        startUrl: row.start_url,
        maxDepth: typeof validFields.maxDepth === 'number' ? validFields.maxDepth : 3,
        maxPages: typeof validFields.maxPages === 'number' ? validFields.maxPages : 50,
        sameOriginOnly:
          typeof validFields.sameOriginOnly === 'boolean' ? validFields.sameOriginOnly : true,
        navTimeoutMs:
          typeof validFields.navTimeoutMs === 'number' ? validFields.navTimeoutMs : 15_000,
        waitAfterNavMs:
          typeof validFields.waitAfterNavMs === 'number' ? validFields.waitAfterNavMs : 500,
        viewport:
          typeof validFields.viewport === 'object' && validFields.viewport !== null
            ? (validFields.viewport as CrawlOptions['viewport'])
            : { width: 1280, height: 800 },
        includeUrlPatterns: Array.isArray(validFields.includeUrlPatterns)
          ? (validFields.includeUrlPatterns as string[])
          : [],
        excludeUrlPatterns: Array.isArray(validFields.excludeUrlPatterns)
          ? (validFields.excludeUrlPatterns as string[])
          : [],
        captureWebVitals:
          typeof validFields.captureWebVitals === 'boolean' ? validFields.captureWebVitals : true,
      } as CrawlOptions;
    }
  }
  return {
    id: row.id,
    startUrl: row.start_url,
    status: row.status as Run['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    options,
    errorMessage: row.error_message,
    pagesDone: row.pages_done ?? 0,
    queueSize: row.queue_size,
    currentUrl: row.current_url,
    harPath: row.har_path ?? null,
  };
}

function parsePageMetrics(raw: string | null): PageMetrics {
  if (!raw) return {};
  try {
    const parsed = PageMetricsSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Legacy / partial rows should still render. Treat bad metrics JSON as absent.
  }
  return {};
}

/**
 * 単一 run を取得する (Issue #87 / HAR ダウンロード endpoint 用)。
 * harPath の解決を server 側で行うため、 lenient parse を経由する。
 */
export function getRun(db: Database.Database, runId: string): Run | null {
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
  if (!row) return null;
  return rowToRun(row);
}

function rowToPage(row: PageRow, meta?: PageV2Meta): PageState {
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
    metrics: parsePageMetrics(row.metrics_json),
    screenId: meta?.screenId ?? null,
    navHash: meta?.navHash ?? null,
    structureHash: meta?.structureHash ?? null,
    stabilityScore: meta?.stability?.score ?? null,
    flaky: meta?.stability?.flaky ?? false,
  };
}

function rowToEdge(row: EdgeRow): Edge {
  return {
    id: row.id,
    runId: row.run_id,
    fromStateId: row.from_state_id ?? row.from_page_state_id,
    toStateId: row.to_state_id ?? row.to_page_state_id,
    kind: (row.kind ?? 'nav') as Edge['kind'],
    fromPageStateId: row.from_page_state_id,
    toPageStateId: row.to_page_state_id,
    trigger: row.trigger as Edge['trigger'],
    triggerSelector: row.trigger_selector,
    triggerText: row.trigger_text,
    createdAt: row.created_at,
  };
}

function rowToScreen(row: ScreenRow): Screen {
  return {
    id: row.id,
    runId: row.run_id,
    url: row.url,
    pathname: row.pathname,
    title: row.title,
    navHash: row.nav_hash,
  };
}

function rowToScreenState(row: ScreenStateRow): ScreenState {
  return {
    id: row.id,
    runId: row.run_id,
    screenId: row.screen_id,
    structureHash: row.structure_hash,
    arrivalTrigger: row.arrival_trigger as ScreenState['arrivalTrigger'],
    arrivalSelector: row.arrival_selector,
  };
}

function tableExists(db: Database.Database, tableName: string): boolean {
  const row = db
    .prepare(`SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(tableName) as { present: number } | undefined;
  return row !== undefined;
}

function originOf(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

export function scoreScreenStability(
  hashes: string[],
  opts: Pick<StabilityOptions, 'threshold'> & { sampleCount?: number } = {},
): Pick<ScreenStability, 'score' | 'sampleCount' | 'distinctHashCount' | 'threshold' | 'flaky'> {
  const sampleCount = opts.sampleCount ?? hashes.length;
  const distinctHashCount = new Set(hashes).size;
  const threshold = opts.threshold ?? DEFAULT_STABILITY_THRESHOLD;
  const score = sampleCount < 2 ? 1 : Math.max(0, 1 - (distinctHashCount - 1) / (sampleCount - 1));
  return {
    score,
    sampleCount,
    distinctHashCount,
    threshold,
    flaky: sampleCount >= 2 && score < threshold,
  };
}

function upsertScreenStability(db: Database.Database, stability: ScreenStability): void {
  if (!tableExists(db, 'screen_stability')) return;
  try {
    db.prepare(
      `INSERT INTO screen_stability (
         origin, screen_nav_hash, score, sample_count, distinct_hash_count,
         threshold, flaky, computed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(origin, screen_nav_hash) DO UPDATE SET
         score = excluded.score,
         sample_count = excluded.sample_count,
         distinct_hash_count = excluded.distinct_hash_count,
         threshold = excluded.threshold,
         flaky = excluded.flaky,
         computed_at = excluded.computed_at`,
    ).run(
      stability.origin,
      stability.navHash,
      stability.score,
      stability.sampleCount,
      stability.distinctHashCount,
      stability.threshold,
      stability.flaky ? 1 : 0,
      stability.computedAt,
    );
  } catch (err) {
    if ((err as { code?: string }).code !== 'SQLITE_READONLY') throw err;
  }
}

export function getScreenStability(
  db: Database.Database,
  navHash: string,
  opts: StabilityOptions = {},
): ScreenStability | null {
  if (!tableExists(db, 'screens') || !tableExists(db, 'screen_states')) return null;
  const windowSize = opts.windowSize ?? DEFAULT_STABILITY_WINDOW;
  const rows = db
    .prepare(
      `SELECT r.id AS run_id, r.started_at, r.start_url, sc.url, st.structure_hash
       FROM screens sc
       JOIN runs r ON r.id = sc.run_id
       JOIN screen_states st ON st.screen_id = sc.id
       WHERE sc.nav_hash = ?
       ORDER BY r.started_at DESC`,
    )
    .all(navHash) as Array<{
    run_id: string;
    started_at: string;
    start_url: string;
    url: string;
    structure_hash: string;
  }>;
  if (rows.length === 0) return null;

  const inferredOrigin = opts.origin ?? originOf(rows[0]!.url) ?? originOf(rows[0]!.start_url);
  if (!inferredOrigin) return null;

  const byRun = new Map<string, string[]>();
  for (const row of rows) {
    const rowOrigin = originOf(row.url) ?? originOf(row.start_url);
    if (rowOrigin !== inferredOrigin) continue;
    if (!byRun.has(row.run_id)) byRun.set(row.run_id, []);
    byRun.get(row.run_id)!.push(row.structure_hash);
  }

  const recentRunIds = Array.from(byRun.keys()).slice(0, windowSize);
  if (recentRunIds.length === 0) return null;
  const hashes = recentRunIds.flatMap((runId) => Array.from(new Set(byRun.get(runId)!)).sort());
  const scored = scoreScreenStability(hashes, { ...opts, sampleCount: recentRunIds.length });
  const stability: ScreenStability = {
    navHash,
    origin: inferredOrigin,
    ...scored,
    computedAt: new Date().toISOString(),
  };
  upsertScreenStability(db, stability);
  return stability;
}

function pageV2MetaByPageId(db: Database.Database, pages: PageRow[]): Map<string, PageV2Meta> {
  const out = new Map<string, PageV2Meta>();
  if (pages.length === 0 || !tableExists(db, 'screens') || !tableExists(db, 'screen_states')) {
    return out;
  }
  const ids = pages.map((p) => p.id);
  const placeholders = ids.map(() => '?').join(', ');
  const rows = db
    .prepare(
      `SELECT st.id AS page_state_id, st.screen_id, st.structure_hash,
              sc.nav_hash, sc.url
       FROM screen_states st
       JOIN screens sc ON sc.id = st.screen_id
       WHERE st.id IN (${placeholders})`,
    )
    .all(...ids) as Array<{
    page_state_id: string;
    screen_id: string;
    structure_hash: string;
    nav_hash: string;
    url: string;
  }>;
  for (const row of rows) {
    out.set(row.page_state_id, {
      screenId: row.screen_id,
      navHash: row.nav_hash,
      structureHash: row.structure_hash,
      stability: getScreenStability(db, row.nav_hash, { origin: originOf(row.url) ?? undefined }),
    });
  }
  return out;
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
  const pageRows = db.prepare(`SELECT * FROM page_states WHERE run_id = ?`).all(runId) as PageRow[];
  const pageMeta = pageV2MetaByPageId(db, pageRows);
  const pages = pageRows.map((row) => rowToPage(row, pageMeta.get(row.id)));
  const edges = (db.prepare(`SELECT * FROM edges WHERE run_id = ?`).all(runId) as EdgeRow[]).map(
    rowToEdge,
  );
  return { run: rowToRun(runRow), pages, edges };
}

export function getStateGraph(db: Database.Database, runId: string): StateGraphPayload | null {
  const runRow = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
  if (!runRow) return null;

  const edges = (db.prepare(`SELECT * FROM edges WHERE run_id = ?`).all(runId) as EdgeRow[]).map(
    rowToEdge,
  );

  if (tableExists(db, 'screens') && tableExists(db, 'screen_states')) {
    const screens = (
      db.prepare(`SELECT * FROM screens WHERE run_id = ?`).all(runId) as ScreenRow[]
    ).map(rowToScreen);
    const states = (
      db.prepare(`SELECT * FROM screen_states WHERE run_id = ?`).all(runId) as ScreenStateRow[]
    ).map(rowToScreenState);
    if (screens.length > 0 || states.length > 0) {
      return { run: rowToRun(runRow), screens, states, edges };
    }
  }

  const pages = db.prepare(`SELECT * FROM page_states WHERE run_id = ?`).all(runId) as PageRow[];
  const screens: Screen[] = pages.map((page) => ({
    id: `sc_${page.id}`,
    runId: page.run_id,
    url: page.url,
    pathname: page.url,
    title: page.title,
    navHash: `legacy:${page.signature}`,
  }));
  const states: ScreenState[] = pages.map((page) => ({
    id: page.id,
    runId: page.run_id,
    screenId: `sc_${page.id}`,
    structureHash: page.signature,
    arrivalTrigger: 'initial',
    arrivalSelector: null,
  }));
  return { run: rowToRun(runRow), screens, states, edges };
}

export function getPageDetail(db: Database.Database, pageStateId: string): PageDetail | null {
  const pageRow = db.prepare(`SELECT * FROM page_states WHERE id = ?`).get(pageStateId) as
    | PageRow
    | undefined;
  if (!pageRow) return null;
  const page = rowToPage(pageRow, pageV2MetaByPageId(db, [pageRow]).get(pageRow.id));
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
    db.prepare(`SELECT * FROM edges WHERE to_page_state_id = ?`).all(pageStateId) as EdgeRow[]
  ).map(rowToEdge);
  const outgoing = (
    db.prepare(`SELECT * FROM edges WHERE from_page_state_id = ?`).all(pageStateId) as EdgeRow[]
  ).map(rowToEdge);
  return { page, console: consoleEntries, network, errors, incoming, outgoing };
}

/**
 * stack trace を group key にできる程度に normalize する (Issue #88)。
 *   - 行末空白除去
 *   - 絶対パスっぽい segment (`(/foo/bar/...)` や `at /foo/...`) の path 部分を伏せる
 *   - chrome-extension:// / webpack:// などのスキーム + path 部分を `<scheme>` に置換
 *   - 行番号 / 列番号は維持 (`:123:45` は残す) — 場所の固定情報として有用
 */
function normalizeStack(stack: string | null): string {
  if (!stack) return '';
  return stack
    .split('\n')
    .map((line) => {
      let l = line.trimEnd();
      // file:///abs/path/foo.js:1:1 → file:///<path>/foo.js:1:1
      l = l.replace(
        /(?:file|https?|webpack|chrome-extension):\/\/[^\s)]*?([^\s/)]+):(\d+):(\d+)/g,
        '<src>/$1:$2:$3',
      );
      // bare absolute path /Users/... / /home/... / /workspace/...
      l = l.replace(
        /\/(Users|home|workspace|var|tmp|opt)\/[^\s)]+?([^\s/)]+):(\d+):(\d+)/g,
        '<src>/$2:$3:$4',
      );
      return l;
    })
    .join('\n');
}

function fingerprintError(kind: string, message: string, stack: string | null): string {
  const normalized = normalizeStack(stack);
  // message を含めることで「同 stack 上で違う message」 (例: 値違いの assertion failure)
  // を別グループにする。 ただし末尾 `: {value}` のような揺らぎ部分は適度に削る。
  const trimmedMessage = message.replace(/\s+/g, ' ').trim().slice(0, 200);
  const input = `${kind}\n${trimmedMessage}\n${normalized}`;
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

interface ErrorRow {
  id: string;
  page_state_id: string;
  kind: string;
  message: string;
  stack: string | null;
  timestamp: string;
}

export function getErrorGroups(db: Database.Database, runId: string): ErrorGroup[] | null {
  const runRow = db.prepare(`SELECT id FROM runs WHERE id = ?`).get(runId) as
    | { id: string }
    | undefined;
  if (!runRow) return null;

  // run 内の全 page_error を 1 クエリで JOIN して取得。
  const rows = db
    .prepare(
      `SELECT e.id, e.page_state_id, e.kind, e.message, e.stack, e.timestamp,
              p.url, p.title
       FROM page_errors e
       JOIN page_states p ON p.id = e.page_state_id
       WHERE p.run_id = ?
       ORDER BY e.timestamp`,
    )
    .all(runId) as Array<ErrorRow & { url: string; title: string }>;

  interface GroupAcc {
    fingerprint: string;
    kind: ErrorGroup['kind'];
    message: string;
    stack: string | null;
    count: number;
    seenPages: Set<string>;
    samplePages: ErrorGroup['samplePages'];
  }

  const groups = new Map<string, GroupAcc>();
  for (const r of rows) {
    const kind = r.kind as ErrorGroup['kind'];
    const fp = fingerprintError(kind, r.message, r.stack);
    let g = groups.get(fp);
    if (!g) {
      g = {
        fingerprint: fp,
        kind,
        message: r.message,
        stack: r.stack,
        count: 0,
        seenPages: new Set(),
        samplePages: [],
      };
      groups.set(fp, g);
    }
    g.count += 1;
    if (!g.seenPages.has(r.page_state_id)) {
      g.seenPages.add(r.page_state_id);
      if (g.samplePages.length < 10) {
        g.samplePages.push({
          pageStateId: r.page_state_id,
          url: r.url,
          title: r.title,
        });
      }
    }
  }
  const out = Array.from(groups.values()).map<ErrorGroup>((g) => ({
    fingerprint: g.fingerprint,
    kind: g.kind,
    message: g.message,
    stack: g.stack,
    count: g.count,
    samplePages: g.samplePages,
  }));
  // 影響度の高い順 (count desc) で返す。 同 count は kind 順で安定化。
  out.sort((a, b) => b.count - a.count || (a.kind < b.kind ? -1 : 1));
  return out;
}

export function getRunErrors(db: Database.Database, runId: string): RunErrorsPayload | null {
  const runRow = db.prepare(`SELECT id FROM runs WHERE id = ?`).get(runId) as
    | { id: string }
    | undefined;
  if (!runRow) return null;

  const pageErrorGroups = getErrorGroups(db, runId);
  if (!pageErrorGroups) return null;
  const pageErrors = pageErrorGroups.reduce((sum, group) => sum + group.count, 0);

  const consoleRows = db
    .prepare(
      `SELECT c.id, c.page_state_id, c.level, c.text, c.url, c.line_number, c.timestamp,
              p.url AS page_url, p.title AS page_title
       FROM console_entries c
       JOIN page_states p ON p.id = c.page_state_id
       WHERE p.run_id = ? AND c.level = 'error'
       ORDER BY c.timestamp`,
    )
    .all(runId) as Array<{
    id: string;
    page_state_id: string;
    level: string;
    text: string;
    url: string | null;
    line_number: number | null;
    timestamp: string;
    page_url: string;
    page_title: string;
  }>;
  const consoleErrors: RunConsoleError[] = consoleRows.map((row) => ({
    id: row.id,
    pageStateId: row.page_state_id,
    level: row.level as RunConsoleError['level'],
    text: row.text,
    url: row.url,
    lineNumber: row.line_number,
    timestamp: row.timestamp,
    page: {
      pageStateId: row.page_state_id,
      url: row.page_url,
      title: row.page_title,
    },
  }));

  const networkRows = db
    .prepare(
      `SELECT n.id, n.page_state_id, n.method, n.url, n.status, n.status_text,
              n.resource_type, n.started_at, n.duration_ms, n.from_cache, n.failed, n.failure_text,
              p.url AS page_url, p.title AS page_title
       FROM network_entries n
       JOIN page_states p ON p.id = n.page_state_id
       WHERE p.run_id = ? AND (n.failed = 1 OR COALESCE(n.status, 0) >= 400)
       ORDER BY n.started_at`,
    )
    .all(runId) as Array<{
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
    page_url: string;
    page_title: string;
  }>;
  const networkErrors: RunNetworkError[] = networkRows.map((row) => ({
    id: row.id,
    pageStateId: row.page_state_id,
    method: row.method,
    url: row.url,
    status: row.status,
    statusText: row.status_text,
    resourceType: row.resource_type,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    fromCache: Boolean(row.from_cache),
    failed: Boolean(row.failed),
    failureText: row.failure_text,
    page: {
      pageStateId: row.page_state_id,
      url: row.page_url,
      title: row.page_title,
    },
  }));

  return {
    runId,
    totals: {
      pageErrors,
      consoleErrors: consoleErrors.length,
      networkErrors: networkErrors.length,
      all: pageErrors + consoleErrors.length + networkErrors.length,
    },
    pageErrorGroups,
    consoleErrors,
    networkErrors,
  };
}

function rowToDiffPage(r: PageRow, meta?: PageV2Meta): RunDiffPage {
  return {
    pageStateId: r.id,
    url: r.url,
    title: r.title,
    signature: r.signature,
    navHash: meta?.navHash ?? null,
    stabilityScore: meta?.stability?.score ?? null,
    flaky: meta?.stability?.flaky ?? false,
    depth: r.depth,
    errorCount: r.error_count,
    consoleErrorCount: r.console_error_count,
    networkErrorCount: r.network_error_count,
  };
}

/**
 * 直前 run を取得する (Intent #125 / Run 差分の「最新 vs 1 つ前」を 1 クリックで)。
 * startUrl が同一かつ started_at が target より古いものの中で最も新しい run id を返す。
 * 見つからなければ null。
 */
export function previousRunOf(db: Database.Database, targetRunId: string): string | null {
  const target = db
    .prepare(`SELECT start_url, started_at FROM runs WHERE id = ?`)
    .get(targetRunId) as { start_url: string; started_at: string } | undefined;
  if (!target) return null;
  const prev = db
    .prepare(
      `SELECT id FROM runs
       WHERE start_url = ? AND started_at < ?
       ORDER BY started_at DESC LIMIT 1`,
    )
    .get(target.start_url, target.started_at) as { id: string } | undefined;
  return prev?.id ?? null;
}

export function getRunDiff(
  db: Database.Database,
  baseRunId: string,
  targetRunId: string,
  opts: { showFlaky?: boolean } = {},
): RunDiff | null {
  const baseRow = db.prepare(`SELECT id FROM runs WHERE id = ?`).get(baseRunId) as
    | { id: string }
    | undefined;
  const targetRow = db.prepare(`SELECT id FROM runs WHERE id = ?`).get(targetRunId) as
    | { id: string }
    | undefined;
  if (!baseRow || !targetRow) return null;

  const basePages = db
    .prepare(`SELECT * FROM page_states WHERE run_id = ?`)
    .all(baseRunId) as PageRow[];
  const targetPages = db
    .prepare(`SELECT * FROM page_states WHERE run_id = ?`)
    .all(targetRunId) as PageRow[];
  const baseMeta = pageV2MetaByPageId(db, basePages);
  const targetMeta = pageV2MetaByPageId(db, targetPages);

  const baseBySig = new Map<string, PageRow>();
  for (const p of basePages) baseBySig.set(p.signature, p);
  const targetBySig = new Map<string, PageRow>();
  for (const p of targetPages) targetBySig.set(p.signature, p);

  const newPages: RunDiffPage[] = [];
  const commonPages: RunDiffPage[] = [];
  for (const [sig, p] of targetBySig.entries()) {
    const page = rowToDiffPage(p, targetMeta.get(p.id));
    if (baseBySig.has(sig)) commonPages.push(page);
    else newPages.push(page);
  }
  const removedPages: RunDiffPage[] = [];
  for (const [sig, p] of baseBySig.entries()) {
    if (!targetBySig.has(sig)) removedPages.push(rowToDiffPage(p, baseMeta.get(p.id)));
  }
  const byImpact = (a: RunDiffPage, b: RunDiffPage) =>
    b.errorCount +
      b.consoleErrorCount +
      b.networkErrorCount -
      (a.errorCount + a.consoleErrorCount + a.networkErrorCount) ||
    a.depth - b.depth ||
    a.url.localeCompare(b.url);
  newPages.sort(byImpact);
  removedPages.sort(byImpact);
  commonPages.sort(byImpact);
  const allChanged = [...newPages, ...removedPages];
  const flakyHiddenCount = opts.showFlaky ? 0 : allChanged.filter((page) => page.flaky).length;
  const visibleNewPages = opts.showFlaky ? newPages : newPages.filter((page) => !page.flaky);
  const visibleRemovedPages = opts.showFlaky
    ? removedPages
    : removedPages.filter((page) => !page.flaky);

  return {
    baseRunId,
    targetRunId,
    newPages: visibleNewPages,
    removedPages: visibleRemovedPages,
    commonPages,
    summary: {
      baseTotal: basePages.length,
      targetTotal: targetPages.length,
      newCount: visibleNewPages.length,
      removedCount: visibleRemovedPages.length,
      commonCount: commonPages.length,
      flakyHiddenCount,
      showFlaky: opts.showFlaky ?? false,
    },
  };
}
