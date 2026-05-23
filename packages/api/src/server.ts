import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { openReadDb } from './db.js';
import { getGraph, getPageDetail, listRuns } from './queries.js';

const PORT = Number(process.env.API_PORT ?? 3001);
const DB_PATH = process.env.DB_PATH ?? './data/db/testworker.sqlite';
const DATA_DIR = resolve(process.env.DATA_DIR ?? './data');

const db = openReadDb(DB_PATH);
const app = new Hono();

app.use('*', cors({ origin: '*' }));

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
  const abs = normalize(join(DATA_DIR, sub));
  // prefix-only check は `/srv/data2` のような sibling を許してしまうため、
  // セパレータ境界 or 完全一致を要求する。
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
