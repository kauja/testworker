import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { log } from '@testworker/shared';
import { openDb } from './client.js';
import { loadRunnerEnv } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const MIGRATIONS_DIR = join(dirname(__filename), 'migrations');
const MIGRATION_FILE_RE = /^(\d{3,})-[\w-]+\.sql$/;

interface Migration {
  version: number;
  name: string;
  sql: string;
}

function appIdForOrigin(origin: string): string {
  return `app_${createHash('sha1').update(origin).digest('hex').slice(0, 12)}`;
}

function originOf(rawUrl: string): string {
  try {
    return new URL(rawUrl).origin;
  } catch {
    return rawUrl;
  }
}

function appNameForOrigin(origin: string): string {
  try {
    return new URL(origin).host || origin;
  } catch {
    return origin;
  }
}

function backfillApps(db: ReturnType<typeof openDb>): void {
  const hasApps = db.$sqlite
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'apps'`)
    .get();
  if (!hasApps) return;
  const runColumns = db.$sqlite.prepare(`PRAGMA table_info(runs)`).all() as Array<{ name: string }>;
  if (!runColumns.some((column) => column.name === 'app_id')) return;

  const rows = db.$sqlite
    .prepare(
      `SELECT id, start_url, started_at
       FROM runs
       WHERE app_id IS NULL
       ORDER BY started_at ASC`,
    )
    .all() as Array<{ id: string; start_url: string; started_at: string }>;
  if (rows.length === 0) return;

  const tx = db.$sqlite.transaction(() => {
    for (const row of rows) {
      const origin = originOf(row.start_url);
      const appId = appIdForOrigin(origin);
      db.$sqlite
        .prepare(
          `INSERT INTO apps (id, name, origin_spec, entry_url, defaults_json, created_at)
           VALUES (?, ?, ?, ?, '{}', ?)
           ON CONFLICT(origin_spec) DO UPDATE SET
             entry_url = COALESCE(apps.entry_url, excluded.entry_url)`,
        )
        .run(appId, appNameForOrigin(origin), origin, row.start_url, row.started_at);
      db.$sqlite.prepare(`UPDATE runs SET app_id = ? WHERE id = ?`).run(appId, row.id);
    }
  });
  tx();
}

function loadMigrations(): Migration[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => MIGRATION_FILE_RE.test(f));
  files.sort();
  const seen = new Set<number>();
  return files.map((name) => {
    const match = name.match(MIGRATION_FILE_RE);
    if (!match || !match[1]) throw new Error(`invalid migration file: ${name}`);
    const version = Number(match[1]);
    if (seen.has(version)) {
      throw new Error(`duplicate migration version ${version} (${name})`);
    }
    seen.add(version);
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8');
    return { version, name, sql };
  });
}

export function migrate(dbPath: string): { applied: string[]; finalVersion: number } {
  const db = openDb(dbPath);
  try {
    const migrations = loadMigrations();
    const row = db.$sqlite.prepare('PRAGMA user_version').get() as
      | { user_version: number }
      | undefined;
    const current = row?.user_version ?? 0;

    const applied: string[] = [];
    for (const m of migrations) {
      if (m.version <= current) continue;
      // SQL 適用と PRAGMA user_version 更新を 1 transaction にまとめ、
      // 途中失敗で「DDL は進んだが version が古い」状態を作らない。
      const tx = db.$sqlite.transaction(() => {
        db.$sqlite.exec(m.sql);
        // user_version は PRAGMA で動的値を bind できないので template literal で組む。
        // version は整数で MIGRATION_FILE_RE で validate 済みのため SQL injection 余地なし。
        db.$sqlite.exec(`PRAGMA user_version = ${m.version}`);
      });
      tx();
      applied.push(m.name);
      log.info({ version: m.version, name: m.name }, 'migration applied');
    }
    backfillApps(db);
    const final = (db.$sqlite.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    return { applied, finalVersion: final };
  } finally {
    db.close();
  }
}

function main(): void {
  const env = loadRunnerEnv();
  const result = migrate(env.dbPath);
  if (result.applied.length === 0) {
    log.info({ version: result.finalVersion, dbPath: env.dbPath }, 'already up-to-date');
  } else {
    log.info(
      { steps: result.applied.length, version: result.finalVersion, dbPath: env.dbPath },
      'migration complete',
    );
  }
}

// tsx 経由 / build 後 node 経由 / Windows path などで `file://` 比較が安定しないため、
// fileURLToPath で OS-native path に揃えて比較する。
const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (isMain) {
  main();
}
