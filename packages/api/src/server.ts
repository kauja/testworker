import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { openReadDb } from './db.js';
import { getGraph, getPageDetail, listRuns } from './queries.js';

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

// `openReadDb` は readonly:true で開くため、 DB ファイルが存在しない初回起動で
// SQLITE_CANTOPEN を投げて api がクラッシュする。 runner の migrate が先に
// 走るのが正規フローなので、 ここでは「ファイル不在 = 未マイグレート」を明示
// メッセージで終了する (5th round critical 2)。
if (!existsSync(DB_PATH)) {
  console.error(
    `[testworker-api] DB not found at ${DB_PATH}. Run \`make migrate\` (or pnpm --filter @testworker/runner run migrate) before starting the api.`,
  );
  process.exit(1);
}

const db = openReadDb(DB_PATH);
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
app.use('/runs/*', cors({ origin: CORS_ORIGIN }));
app.use('/pages/*', cors({ origin: CORS_ORIGIN }));

app.get('/health', (c) => c.json({ ok: true }));

app.get('/runs', (c) => c.json(listRuns(db)));

app.get('/runs/:id/graph', (c) => {
  const graph = getGraph(db, c.req.param('id'));
  if (!graph) return c.json({ error: 'not_found' }, 404);
  return c.json(graph);
});

app.get('/pages/:id', (c) => {
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
  console.log(`[testworker-api] listening on http://0.0.0.0:${info.port}`);
});
