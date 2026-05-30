import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function openReadDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  // Issue #191: schedule settings and scheduler ticks are API-owned writes.
  // Keep the historical function name to avoid a broad rename.
  const db = new Database(path, { fileMustExist: false });
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
