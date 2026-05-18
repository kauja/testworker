#!/usr/bin/env node
/**
 * PostToolUse(Write|Edit|MultiEdit) hook.
 *
 * 編集したファイルが prettier 対象なら自動 format。
 * 重い処理は走らせない（typecheck/lint 全実行は Stop hook に寄せる）。
 *
 *  - node_modules が無いときは静かに skip（初期セットアップ前）
 *  - サポート拡張子: ts, tsx, js, mjs, cjs, jsx, json, md, mdx, yml, yaml, css
 *  - .claude/local など gitignore 配下も skip
 */

import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, relative } from 'node:path';

const ROOT = process.cwd();
const payload = JSON.parse(readFileSync(0, 'utf-8'));
const input = payload?.tool_input ?? {};
const path = String(input.file_path ?? input.path ?? '');
if (!path) process.exit(0);

const PRETTIER_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.json',
  '.md',
  '.mdx',
  '.yml',
  '.yaml',
  '.css',
]);

const ext = extname(path).toLowerCase();
if (!PRETTIER_EXTS.has(ext)) process.exit(0);

const rel = relative(ROOT, path);
if (rel.startsWith('..') || rel.startsWith('node_modules/') || rel.startsWith('.claude/local/')) {
  process.exit(0);
}

if (!existsSync(`${ROOT}/node_modules/.bin/prettier`)) {
  // セットアップ前なので何もしない（騒がしくしない）
  process.exit(0);
}

const result = spawnSync('node_modules/.bin/prettier', ['--write', '--log-level=warn', rel], {
  cwd: ROOT,
  stdio: 'pipe',
  encoding: 'utf-8',
});

if (result.status !== 0) {
  process.stderr.write(`[harness] prettier failed on ${rel}:\n${result.stderr || result.stdout}\n`);
  // format 失敗は block しない（自分の編集なので警告のみ）
}

process.exit(0);
