#!/usr/bin/env node
/**
 * 古い run の自動 purge CLI (Intent #124 / Bolt: retention policy)。
 *
 * 使い方:
 *   pnpm --filter @testworker/runner run purge -- --keep-last 30
 *   pnpm --filter @testworker/runner run purge -- --older-than 30d
 *   pnpm --filter @testworker/runner run purge -- --dry-run --keep-last 5
 *
 * - `--keep-last N`: started_at 降順で最新 N 件を残し残りを削除
 * - `--older-than <spec>`: 30d / 7d / 24h など。 現在時刻からそれより古いものを削除
 * - `--dry-run`: DB 更新 / FS 削除を行わず、 対象 ID と件数だけ表示
 * - 両方指定した場合は AND (より積極的に消す側でなく) で交差 — つまり「最新 N 件
 *   は残し、 さらに古いものから順に N 件超過分を消す」 = keep-last 優先で older-than
 *   は無視される。 意図的にシンプル化。
 *
 * SQLite 側は ON DELETE CASCADE が page_states / edges / console / network / errors
 * に伝播するので runs だけ DELETE すれば子テーブルも消える。
 * FS 側は data/runs/<runId>/ ディレクトリを再帰削除する。
 */

import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { log } from '@testworker/shared';
import { openDb } from './client.js';
import { loadRunnerEnv } from '../config.js';

interface PurgeOptions {
  keepLast?: number;
  olderThanMs?: number;
  dryRun: boolean;
}

interface RunRow {
  id: string;
  started_at: string;
}

export interface PurgeResult {
  scanned: number;
  deleted: string[];
  kept: number;
  dryRun: boolean;
}

/**
 * `--older-than 30d` / `24h` / `90m` を ms に変換する。 失敗時は throw。
 */
export function parseDuration(spec: string): number {
  const m = spec.trim().match(/^(\d+)\s*(d|h|m)$/i);
  if (!m || !m[1] || !m[2]) {
    throw new Error(`invalid --older-than spec: ${spec} (expected like "30d", "24h", "90m")`);
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  const factor = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : 60_000;
  return n * factor;
}

/**
 * 削除対象 run id を計算する (DB / FS には触らない、 pure)。
 * keepLast > 0 が指定されていればそれを優先。
 */
function selectVictims(rows: RunRow[], opts: PurgeOptions): string[] {
  // started_at 降順 (新 → 古) に並べる。 同 ts のときは id で安定化。
  const sorted = [...rows].sort((a, b) => {
    if (a.started_at < b.started_at) return 1;
    if (a.started_at > b.started_at) return -1;
    return a.id < b.id ? 1 : -1;
  });
  if (opts.keepLast != null && opts.keepLast >= 0) {
    return sorted.slice(opts.keepLast).map((r) => r.id);
  }
  if (opts.olderThanMs != null) {
    const cutoff = Date.now() - opts.olderThanMs;
    return sorted.filter((r) => new Date(r.started_at).getTime() < cutoff).map((r) => r.id);
  }
  return [];
}

export async function purge(
  dbPath: string,
  dataDir: string,
  opts: PurgeOptions,
): Promise<PurgeResult> {
  const db = openDb(dbPath);
  try {
    const rows = db.$sqlite.prepare('SELECT id, started_at FROM runs').all() as RunRow[];
    const victims = selectVictims(rows, opts);
    const kept = rows.length - victims.length;

    if (opts.dryRun || victims.length === 0) {
      return { scanned: rows.length, deleted: victims, kept, dryRun: opts.dryRun };
    }

    // DB は ON DELETE CASCADE で子も消える。 transaction で一括。
    const stmt = db.$sqlite.prepare('DELETE FROM runs WHERE id = ?');
    const tx = db.$sqlite.transaction((ids: string[]) => {
      for (const id of ids) stmt.run(id);
    });
    tx(victims);

    // FS 側: data/runs/<runId>/ を再帰削除。 1 つ失敗しても残りは消す。
    for (const id of victims) {
      const runDir = join(dataDir, 'runs', id);
      try {
        await rm(runDir, { recursive: true, force: true });
      } catch (err) {
        log.warn({ runDir, err: (err as Error).message }, 'purge FS delete failed');
      }
    }
    return { scanned: rows.length, deleted: victims, kept, dryRun: false };
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'keep-last': { type: 'string' },
      'older-than': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const opts: PurgeOptions = {
    keepLast: values['keep-last'] != null ? Number(values['keep-last']) : undefined,
    olderThanMs: values['older-than'] ? parseDuration(values['older-than']) : undefined,
    dryRun: Boolean(values['dry-run']),
  };
  if (opts.keepLast == null && opts.olderThanMs == null) {
    log.error('usage: purge --keep-last N | --older-than <30d|24h|90m> [--dry-run]');
    process.exit(2);
  }
  if (opts.keepLast != null && (!Number.isInteger(opts.keepLast) || opts.keepLast < 0)) {
    log.error('--keep-last must be a non-negative integer');
    process.exit(2);
  }

  const env = loadRunnerEnv();
  const result = await purge(env.dbPath, env.dataDir, opts);
  log.info(
    {
      scanned: result.scanned,
      deletedCount: result.deleted.length,
      kept: result.kept,
      dryRun: result.dryRun,
      deletedIds: result.deleted,
    },
    result.dryRun ? 'purge dry-run' : 'purge complete',
  );
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, 'purge failed');
    process.exit(1);
  });
}
