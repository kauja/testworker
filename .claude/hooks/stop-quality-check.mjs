#!/usr/bin/env node
/**
 * Stop hook.
 *
 * 会話が一段落するタイミングで品質チェックを走らせ、結果をエージェントに見せる。
 *
 *  - 差分が無ければ skip
 *  - node_modules が無ければ skip（提案だけ出す）
 *  - typecheck + lint をパッケージスコープで実行（変更パッケージのみ）
 *  - 失敗しても block はしない（情報を返すだけ）
 *
 * Claude Code は Stop hook の stdout を model に見せるため、結果を簡潔に出す。
 */

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const HAS_DEPS = existsSync(`${ROOT}/node_modules/.pnpm`) || existsSync(`${ROOT}/node_modules`);

function git(args) {
  return spawnSync('git', args, { cwd: ROOT, encoding: 'utf-8' });
}

const status = git(['status', '--porcelain']).stdout?.trim();
if (!status) process.exit(0);

const diffNames =
  git(['diff', '--name-only', 'HEAD']).stdout?.trim().split('\n').filter(Boolean) ?? [];

const touchedPkgs = new Set();
for (const name of diffNames) {
  const m = name.match(/^packages\/([^/]+)\//);
  if (m) touchedPkgs.add(m[1]);
}

if (!HAS_DEPS) {
  console.log(
    `[harness] 未インストール (node_modules なし) — 品質チェック skip。\n` +
      `  推奨: pnpm install を実行してから再度差分を出すこと。`,
  );
  process.exit(0);
}

if (touchedPkgs.size === 0) {
  process.exit(0);
}

const lines = [];
for (const pkg of touchedPkgs) {
  const tc = spawnSync('pnpm', ['--filter', `@testworker/${pkg}`, 'run', 'typecheck'], {
    cwd: ROOT,
    encoding: 'utf-8',
    timeout: 90_000,
  });
  if (tc.status !== 0) {
    lines.push(`✗ @testworker/${pkg}: typecheck FAILED`);
    lines.push(tc.stderr.slice(-2000) || tc.stdout.slice(-2000));
  } else {
    lines.push(`✓ @testworker/${pkg}: typecheck OK`);
  }
}

console.log(`[harness] quality check (${[...touchedPkgs].join(', ')}):\n${lines.join('\n')}`);
process.exit(0);
