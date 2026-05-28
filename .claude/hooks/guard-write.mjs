#!/usr/bin/env node
/**
 * PreToolUse(Write|Edit|MultiEdit) guard.
 *
 *  - 秘密情報 / テスト対象アプリ / 私的データの書き込みを止める
 *  - .gitignore 自体に「危険な追加」（!data/ 等の例外追加）が混じった時に警告
 */

import { readFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const payload = JSON.parse(readFileSync(0, 'utf-8'));
const input = payload?.tool_input ?? {};
const path = String(input.file_path ?? input.path ?? '');
const content = String(input.content ?? input.new_string ?? '');

function block(reason) {
  process.stderr.write(`[harness] BLOCKED: ${reason}\nPath: ${path}\n`);
  process.exit(2);
}
function warn(msg) {
  process.stderr.write(`[harness] WARN: ${msg}\nPath: ${path}\n`);
}

if (!path) process.exit(0);

const abs = resolve(path);
const lower = abs.toLowerCase();

// ハーネス自己改変防止 + sandbox 防御。 文字列 fragment match で block するパス。
// source path に同名が出ない token に限る。 `auth` だけは packages/runner/src/auth/ など
// source path に重複するので、 BANNED_DIR_FRAGMENTS から除外し、 別途 repo-root 直下
// 限定の判定を下で行う (#73)。 .claude / .github/workflows / scripts は source path
// に重複しないため fragment match で OK (#63)。
const BANNED_DIR_FRAGMENTS = [
  `${sep}.git${sep}`,
  `${sep}.github${sep}workflows${sep}`,
  `${sep}.claude${sep}`,
  `${sep}scripts${sep}`,
  `${sep}test-target${sep}`,
  `${sep}test-targets${sep}`,
  `${sep}fixtures-private${sep}`,
  `${sep}secrets${sep}`,
  `${sep}data${sep}runs${sep}`,
];
for (const f of BANNED_DIR_FRAGMENTS) {
  if (lower.includes(f)) block(`書き込み禁止ディレクトリ: ${f.replaceAll(sep, '/')}`);
}

// `auth` は cwd (= repo root) 直下のみ block。 storage-state や個人 session の
// sandbox を守りつつ、 packages/runner/src/auth/ 等の source は許容する。
const TOP_AUTH = resolve(process.cwd(), 'auth');
if (abs === TOP_AUTH || abs.startsWith(TOP_AUTH + sep)) {
  block('書き込み禁止ディレクトリ: repo root の auth/ (storage-state 等の sandbox)');
}

const BANNED_FILES = [/\.env(?:\.|$)/, /storage-state[^/]*\.json$/i, /\.har$/i];
for (const re of BANNED_FILES) {
  if (re.test(abs)) block('秘密情報またはキャプチャファイルへの書き込みは禁止');
}

// .gitignore に「除外を弱める」変更が入っていたら警告（block ではない）
if (abs.endsWith(`${sep}.gitignore`)) {
  const lines = content.split('\n').map((l) => l.trim());
  const reAddNegate = /^!(?:data|auth|test-target|test-targets|fixtures-private|secrets|\.env)/;
  for (const l of lines) {
    if (reAddNegate.test(l)) {
      warn(`.gitignore の除外解除（${l}）が含まれています。意図的でなければ取り消してください。`);
    }
  }
}

// 明らかに秘密値らしき内容（AKIA... / -----BEGIN ... PRIVATE KEY-----）を書こうとしたら止める
if (content) {
  const SECRET_PATTERNS = [
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (?:RSA|EC|OPENSSH|PGP) PRIVATE KEY-----/,
    /-----BEGIN PRIVATE KEY-----/,
    /xox[abprs]-[A-Za-z0-9-]{10,}/, // Slack token
    /ghp_[A-Za-z0-9]{30,}/, // GitHub personal token
    /sk-[A-Za-z0-9-_]{20,}/, // OpenAI / Anthropic style key
  ];
  for (const re of SECRET_PATTERNS) {
    if (re.test(content)) block(`秘密値らしきパターンが検出されました（pattern: ${re}）。`);
  }
}

process.exit(0);
