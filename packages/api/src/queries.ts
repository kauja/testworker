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
  PageState,
  Run,
  RunDiff,
  RunDiffPage,
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
  /**
   * Issue #86 で追加。 migration 002 以前に挿入された行は SELECT 時に
   * DEFAULT 0 / NULL で埋まる。 better-sqlite3 から column 自体が
   * 抜けるケース (古い DB ファイル) では undefined になるため lenient に扱う。
   */
  pages_done: number | null;
  queue_size: number | null;
  current_url: string | null;
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
    console.warn(
      `[testworker-api] run ${row.id}: options_json JSON.parse failed`,
      (err as Error).message,
    );
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
    console.warn(
      `[testworker-api] run ${row.id}: options_json schema mismatch`,
      parsed.error.flatten(),
    );
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
  };
}

export function getRun(db: Database.Database, runId: string): Run | null {
  const row = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
  if (!row) return null;
  return rowToRun(row);
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
  const pages = (
    db.prepare(`SELECT * FROM page_states WHERE run_id = ?`).all(runId) as PageRow[]
  ).map(rowToPage);
  const edges = (db.prepare(`SELECT * FROM edges WHERE run_id = ?`).all(runId) as EdgeRow[]).map(
    rowToEdge,
  );
  return { run: rowToRun(runRow), pages, edges };
}

export function getPageDetail(db: Database.Database, pageStateId: string): PageDetail | null {
  const pageRow = db.prepare(`SELECT * FROM page_states WHERE id = ?`).get(pageStateId) as
    | PageRow
    | undefined;
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

function rowToDiffPage(r: PageRow): RunDiffPage {
  return {
    pageStateId: r.id,
    url: r.url,
    title: r.title,
    signature: r.signature,
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

  const baseBySig = new Map<string, PageRow>();
  for (const p of basePages) baseBySig.set(p.signature, p);
  const targetBySig = new Map<string, PageRow>();
  for (const p of targetPages) targetBySig.set(p.signature, p);

  const newPages: RunDiffPage[] = [];
  const commonPages: RunDiffPage[] = [];
  for (const [sig, p] of targetBySig.entries()) {
    if (baseBySig.has(sig)) commonPages.push(rowToDiffPage(p));
    else newPages.push(rowToDiffPage(p));
  }
  const removedPages: RunDiffPage[] = [];
  for (const [sig, p] of baseBySig.entries()) {
    if (!targetBySig.has(sig)) removedPages.push(rowToDiffPage(p));
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

  return {
    baseRunId,
    targetRunId,
    newPages,
    removedPages,
    commonPages,
    summary: {
      baseTotal: basePages.length,
      targetTotal: targetPages.length,
      newCount: newPages.length,
      removedCount: removedPages.length,
      commonCount: commonPages.length,
    },
  };
}
