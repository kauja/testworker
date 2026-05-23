import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';

export function openReadDb(path: string): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  // api は read 専用。WAL journal は runner (openDb) 側で設定済みで、
  // ここで再設定すると readonly フラグと矛盾する。
  return new Database(path, { readonly: true, fileMustExist: false });
}
