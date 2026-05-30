import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { RunLaunchInput, log } from '@testworker/shared';
import { openReadDb } from './db.js';
import {
  getErrorGroups,
  getAppDetail,
  getGraph,
  getPageDetail,
  getRun,
  getRunDiff,
  getRunErrors,
  getRunStateGraphDiff,
  getScreenStability,
  getStateGraph,
  listApps,
  listRuns,
  previousRunOf,
} from './queries.js';
import { launchCrawl } from './run-launcher.js';

const PORT = Number(process.env.API_PORT ?? 3001);
const DB_PATH = process.env.DB_PATH ?? './data/db/testworker.sqlite';
// 比較側は symlink を展開した実体パスで持っておく。これがないと
// DATA_DIR/foo が外部を指す symlink でも prefix チェックを通過してしまう。
// realpath は存在しないとエラーになるため、 fallback で resolve だけ使う。
const DATA_DIR = (() => {
  const r = resolve(process.env.DATA_DIR ?? './data');
  try {
    return realpathSync(r);
  } catch {
    return r;
  }
})();

// `openReadDb` は readonly:true で開くため、 DB ファイルが存在しないと
// SQLITE_CANTOPEN を投げる。 runner の migrate が走る前に api だけ起動した場合
// (`make up` を `make migrate` の前に実行した場合) でも process.exit すると、
// `tsx watch` の再起動 loop に入り Onboarding 体験が壊れる (#141)。
// listen は開始しつつ、 DB が現れるまで polling で待ち、 query 系 handler は
// 503 + hint メッセージを返す方針に切り替える。
const DB_RETRY_INTERVAL_MS = 1500;
let dbInstance: ReturnType<typeof openReadDb> | null = null;

function ensureDb(): typeof dbInstance {
  if (dbInstance) return dbInstance;
  if (!existsSync(DB_PATH)) return null;
  try {
    dbInstance = openReadDb(DB_PATH);
    log.info({ dbPath: DB_PATH }, 'DB opened');
    return dbInstance;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'DB open failed (will retry)',
    );
    return null;
  }
}

async function pollUntilDbReady(): Promise<void> {
  let waitedLogged = false;
  while (!ensureDb()) {
    if (!waitedLogged) {
      log.warn(
        { dbPath: DB_PATH },
        'DB not found. Run `make migrate` to initialize. /runs etc. will return 503 until ready.',
      );
      waitedLogged = true;
    }
    await new Promise((r) => setTimeout(r, DB_RETRY_INTERVAL_MS));
  }
}

const DB_NOT_READY_BODY = {
  error: 'db_not_ready',
  hint: 'Database not initialized. Run `make migrate` (or `pnpm --filter @testworker/runner run db:migrate`).',
} as const;

void pollUntilDbReady();
const app = new Hono();

// CORS_ORIGIN 環境変数で許可 origin を制限する (Issue #103, defense in depth)。
//   - 未設定 / `*` → wildcard (デフォルト、 dev 利便性)
//   - CSV (例: `https://app.example.com,https://staging.example.com`) → allowlist
// 値は trim + 空除去。 list が空になった場合は wildcard に fallback。
const CORS_ORIGIN: string | string[] = (() => {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || raw.trim() === '' || raw.trim() === '*') return '*';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length === 0 ? '*' : list;
})();

// CORS は JSON API のみに付ける。 /assets/* に wildcard CORS を付けると、
// 攻撃者ページから fetch('/assets/runs/.../screenshot.png') で screenshot や
// HAR の中身を読み取れてしまう (Issue #95)。 撮影対象の管理画面に映った
// 秘密情報が cross-origin で漏れるのを SOP (Same-Origin Policy) で防ぐため、
// /assets/* には Access-Control-Allow-Origin を付けない。
app.use('/health', cors({ origin: CORS_ORIGIN }));
app.use('/runs', cors({ origin: CORS_ORIGIN }));
app.use('/runs/*', cors({ origin: CORS_ORIGIN }));
app.use('/apps', cors({ origin: CORS_ORIGIN }));
app.use('/apps/*', cors({ origin: CORS_ORIGIN }));
app.use('/pages/*', cors({ origin: CORS_ORIGIN }));

app.get('/health', (c) => c.json({ ok: true, dbReady: dbInstance !== null }));

app.get('/runs', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  return c.json(listRuns(db));
});

app.get('/apps', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  return c.json(listApps(db));
});

app.get('/apps/:id', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const detail = getAppDetail(db, c.req.param('id'));
  if (!detail) return c.json({ error: 'not_found' }, 404);
  return c.json(detail);
});

app.post('/apps/:id/runs', async (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const detail = getAppDetail(db, c.req.param('id'));
  if (!detail) return c.json({ error: 'not_found' }, 404);
  let body: unknown = {};
  try {
    body = await c.req.json();
  } catch {
    body = {};
  }
  const parsed = RunLaunchInput.safeParse({
    startUrl: detail.app.entryUrl,
    ...(typeof body === 'object' && body !== null ? body : {}),
  });
  if (!parsed.success) {
    return c.json({ error: 'invalid_run_options', issues: parsed.error.flatten() }, 400);
  }
  try {
    launchCrawl(parsed.data);
  } catch (err) {
    return c.json(
      { error: 'runner_launch_failed', message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }
  return c.json(
    { accepted: true, acceptedAt: new Date().toISOString(), options: parsed.data },
    202,
  );
});

app.post('/runs', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = RunLaunchInput.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_run_options', issues: parsed.error.flatten() }, 400);
  }

  try {
    launchCrawl(parsed.data);
  } catch (err) {
    return c.json(
      { error: 'runner_launch_failed', message: err instanceof Error ? err.message : String(err) },
      500,
    );
  }

  return c.json(
    {
      accepted: true,
      acceptedAt: new Date().toISOString(),
      options: parsed.data,
    },
    202,
  );
});

app.get('/runs/:id', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const run = getRun(db, c.req.param('id'));
  if (!run) return c.json({ error: 'not_found' }, 404);
  // 走行中の run は polling で進捗を取り直すため、 中間 cache に乗らないよう no-store。
  // 完了済みは default の cache を許す。
  if (run.status === 'running' || run.status === 'queued') {
    c.header('Cache-Control', 'no-store');
  }
  return c.json(run);
});

app.get('/runs/:id/graph', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const graph = getGraph(db, c.req.param('id'));
  if (!graph) return c.json({ error: 'not_found' }, 404);
  return c.json(graph);
});

app.get('/runs/:id/state-graph', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const graph = getStateGraph(db, c.req.param('id'));
  if (!graph) return c.json({ error: 'not_found' }, 404);
  return c.json(graph);
});

/**
 * Issue #87: HAR ファイルダウンロード。
 * runs.har_path に記録された DATA_DIR 相対パスを stream する。 path traversal は
 * /assets/* と同じく境界 check + realpath で防ぐ。
 *
 * `/har/:id` という別 path にしているのは、 /runs/* に付けた wildcard CORS の影響を
 * 受けないようにするため (Issue #95 と同じ理由)。 HAR には request URL / header /
 * cookie 名等が含まれる可能性があるので、 攻撃 origin から fetch で読み取られない
 * よう Same-Origin Policy に倒す。 ブラウザからの download attribute / 直接 nav
 * 経由なら CORS は関係しない。
 */
app.get('/har/:id', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const runId = c.req.param('id');
  const run = getRun(db, runId);
  if (!run) return c.json({ error: 'not_found' }, 404);
  if (!run.harPath) return c.json({ error: 'har_not_recorded' }, 404);

  const requested = normalize(join(DATA_DIR, run.harPath));
  if (requested !== DATA_DIR && !requested.startsWith(DATA_DIR + sep)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  let abs: string;
  try {
    abs = realpathSync(requested);
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
  if (abs !== DATA_DIR && !abs.startsWith(DATA_DIR + sep)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return c.json({ error: 'not_found' }, 404);
    const stream = createReadStream(abs);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: {
        'content-type': 'application/json',
        'content-disposition': `attachment; filename="run-${runId}-network.har"`,
        'cache-control': 'public, max-age=300',
      },
    });
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
});

app.get('/runs/:id/errors/grouped', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const groups = getErrorGroups(db, c.req.param('id'));
  if (groups == null) return c.json({ error: 'not_found' }, 404);
  return c.json(groups);
});

app.get('/runs/:id/errors', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const errors = getRunErrors(db, c.req.param('id'));
  if (errors == null) return c.json({ error: 'not_found' }, 404);
  return c.json(errors);
});

app.get('/runs/:id/diff', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const target = c.req.param('id');
  const showFlaky = c.req.query('showFlaky') === '1' || c.req.query('showFlaky') === 'true';
  const kind = c.req.query('kind') ?? 'screen';
  // ?base=previous で「1 つ前の run」を自動選択。 startUrl が同じ run の中で
  // started_at が target より古い最新を base にする (Intent #125 / Issue #85)。
  let baseId = c.req.query('base');
  if (!baseId || baseId === 'previous') {
    const prev = previousRunOf(db, target);
    if (!prev) return c.json({ error: 'no_previous_run' }, 404);
    baseId = prev;
  }
  if (kind === 'state') {
    const diff = getRunStateGraphDiff(db, baseId, target, { showFlaky });
    if (!diff) return c.json({ error: 'not_found' }, 404);
    return c.json(diff);
  }
  if (kind !== 'screen') return c.json({ error: 'invalid_kind' }, 400);
  const diff = getRunDiff(db, baseId, target, { showFlaky });
  if (!diff) return c.json({ error: 'not_found' }, 404);
  return c.json(diff);
});

app.get('/screens/:navHash/stability', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const windowSize = Number(c.req.query('window') ?? 5);
  const threshold = Number(c.req.query('threshold') ?? 0.5);
  const stability = getScreenStability(db, c.req.param('navHash'), {
    origin: c.req.query('origin'),
    windowSize: Number.isFinite(windowSize) && windowSize > 0 ? windowSize : 5,
    threshold: Number.isFinite(threshold) ? threshold : 0.5,
  });
  if (!stability) return c.json({ error: 'not_found' }, 404);
  return c.json(stability);
});

app.get('/pages/:id', (c) => {
  const db = ensureDb();
  if (!db) return c.json(DB_NOT_READY_BODY, 503);
  const detail = getPageDetail(db, c.req.param('id'));
  if (!detail) return c.json({ error: 'not_found' }, 404);
  return c.json(detail);
});

/**
 * 静的アセット（スクリーンショット等）。
 * DATA_DIR の外に出るパスは弾く。
 */
app.get('/assets/*', (c) => {
  const sub = c.req.path.replace(/^\/assets\//, '');
  const requested = normalize(join(DATA_DIR, sub));
  // prefix-only check は `/srv/data2` のような sibling を許してしまうため、
  // セパレータ境界 or 完全一致を要求する。
  if (requested !== DATA_DIR && !requested.startsWith(DATA_DIR + sep)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  let abs: string;
  try {
    // DATA_DIR 配下に外部を指す symlink があっても、ここで実体パスに解決して
    // 再度 prefix チェックする (symlink escape 防止)。realpathSync は file が
    // 存在しないと throw するので、ここでまとめて 404 にもなる。
    abs = realpathSync(requested);
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
  if (abs !== DATA_DIR && !abs.startsWith(DATA_DIR + sep)) {
    return c.json({ error: 'forbidden' }, 403);
  }
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) return c.json({ error: 'not_found' }, 404);
    const stream = createReadStream(abs);
    const mime =
      extname(abs) === '.png'
        ? 'image/png'
        : extname(abs) === '.jpg' || extname(abs) === '.jpeg'
          ? 'image/jpeg'
          : extname(abs) === '.har' || extname(abs) === '.json'
            ? 'application/json'
            : 'application/octet-stream';
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      headers: { 'content-type': mime, 'cache-control': 'public, max-age=300' },
    });
  } catch {
    return c.json({ error: 'not_found' }, 404);
  }
});

serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info({ port: info.port }, 'api listening');
});
