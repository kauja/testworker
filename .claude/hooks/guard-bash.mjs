#!/usr/bin/env node
/**
 * PreToolUse(Bash) guard.
 *
 * settings.json の permissions.deny で大半は弾けるが、
 *  - 文字列パターンで拾いきれない複合コマンド（`a && b`, `a | b`）
 *  - 「main へ何かをする」を引数の文脈で判断したい
 *  - 機密ファイル名の引数を含むコマンド
 * といった「文脈付きの危険」は denylist では不十分なので、ここで補強する。
 *
 * 出力フォーマット:
 *   - 終了コード 0  → 通過
 *   - 終了コード 2  → ブロック（stderr が Claude に見える）
 *   - JSON を stdout に出して decision を制御することも可能（permissionDecision）。
 */

import { readFileSync } from 'node:fs';

const payload = JSON.parse(readFileSync(0, 'utf-8'));
const cmd = String(payload?.tool_input?.command ?? '');

function block(reason) {
  process.stderr.write(`[harness] BLOCKED: ${reason}\nCommand:\n  ${cmd}\n`);
  process.exit(2);
}

/**
 * `git push ...` のセグメントから「target に main を含むか」を判定する。
 * refs/heads/main / HEAD:main / HEAD:refs/heads/main / +main / 'main' / "main"
 * のような表現を全部捕まえる。
 */
function detectMainPush(segment) {
  // 末尾の改行・パイプ前で切る
  const text = segment.replace(/[|;&].*$/s, '');
  // git push の引数だけ取り出す
  const m = text.match(/\bgit\s+push\b\s*(.*)$/);
  if (!m) return false;
  const args = (m[1] ?? '').split(/\s+/).filter(Boolean);
  for (const raw of args) {
    if (raw.startsWith('-')) continue;
    const stripped = raw.replace(/^['"]|['"]$/g, '');
    // colon が含まれる refspec は rhs を target とする
    const rhs = stripped.includes(':') ? stripped.split(':').pop() : stripped;
    if (!rhs) continue;
    const target = rhs.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    if (target === 'main') return true;
  }
  return false;
}

/**
 * `git add ...` で「リポルート / カレントディレクトリ丸ごと」を意味する引数を含むか判定。
 * `.`, `./`, `:/`, `:(top)`, `-A`, `--all`, quoted variants をカバー。
 */
function detectAddEverything(segment) {
  const text = segment.replace(/[|;&].*$/s, '');
  const m = text.match(/\bgit\s+add\b\s*(.*)$/);
  if (!m) return false;
  const args = (m[1] ?? '').split(/\s+/).filter(Boolean);
  for (const raw of args) {
    if (raw === '--') break; // 以降は pathspec literal
    if (raw === '-A' || raw === '--all') return true;
    if (raw.startsWith('-')) continue;
    const stripped = raw.replace(/^['"]|['"]$/g, '').trim();
    if (
      stripped === '.' ||
      stripped === './' ||
      stripped === ':/' ||
      stripped.startsWith(':(top') ||
      stripped.startsWith(':/')
    ) {
      return true;
    }
  }
  return false;
}

const RULES = [
  // ---- main ブランチへの直接介入 ----
  {
    re: /\bgit\s+push\b/,
    check: (c) => detectMainPush(c),
    why: 'main は保護されている。feat/* ブランチ → PR → auto-merge で進めること。',
  },
  {
    re: /\bgit\s+commit\s+--amend\b/,
    why: 'amend はハーネス方針で禁止（こまめな commit が原則）。新しい commit を積むこと。',
  },
  {
    re: /\bgit\s+rebase\s+(?:-i|--interactive|--root)\b/,
    why: '対話的 rebase は禁止（履歴改変はレビュー困難）。',
  },
  {
    re: /--no-verify\b/,
    why: '--no-verify はハーネス方針で禁止（pre-commit / commit-msg の bypass）。',
  },
  {
    re: /\bgit\s+push\s+(?:[^|;&]*\s+)?(?:-f|--force|--force-with-lease)\b/,
    why: 'force push は禁止。',
  },

  // ---- リポジトリの破壊的操作 ----
  {
    re: /\bgh\s+repo\s+(?:delete|archive|unarchive|rename|edit\b[^|;&]*--visibility)\b/,
    why: 'リポジトリ自体への破壊的変更は必ず人手で行う。',
  },
  {
    re: /\bgh\s+api\b[^|;&]*--method\s+DELETE\b/,
    why: 'gh api DELETE はリソース削除。人手で行うこと。',
  },
  {
    re: /\bgh\s+api\b[^|;&]*branches\/[^\/]+\/protection\b[^|;&]*--method\s+(DELETE|PUT)/,
    why: 'ブランチ保護の変更は人手で行う（拡大解釈禁止）。',
  },

  // ---- ファイルシステムの破壊 ----
  {
    re: /\brm\s+-rf?\s+\/(?:\s|$)/,
    why: 'rm -rf / は禁止。',
  },
  {
    re: /\brm\s+-rf?\s+(?:~|\$HOME)(?:\/|\s|$)/,
    why: 'rm -rf ~ は禁止。',
  },
  {
    re: /\brm\s+-rf?\s+\.\.(?:\/|\s|$)/,
    why: '親ディレクトリへの再帰削除は禁止。',
  },
  {
    re: /\brm\s+-rf?\s+\.git(?:\/|\s|$)/,
    why: '.git の削除は禁止。',
  },
  {
    re: /\bsudo\b/,
    why: 'sudo は禁止（ユーザ権限の昇格は人手）。',
  },
  {
    re: /\bchmod\s+-R\s+777\b/,
    why: 'chmod -R 777 は禁止。',
  },

  // ---- 認証情報 ----
  {
    re: /\bgh\s+auth\s+(?:logout|refresh)\b/,
    why: 'gh 認証の変更は人手で行うこと。',
  },
  {
    re: /\bgit\s+config\s+--(?:global|system)\b/,
    why: 'git の global / system 設定変更は人手で行うこと。',
  },

  // ---- 秘密情報のリスク ----
  {
    re: /\bgit\s+add\s+(?:[^|;&]*\s+)?(?:\.env|\.env\.[A-Za-z._-]+|auth\/|storage-state[^\s]*|.*\.har)\b/,
    why: '秘密情報・キャプチャ系（.env / auth / storage-state / *.har）の add は禁止。',
  },
  {
    re: /\bgit\s+add\s+(?:[^|;&]*\s+)?(?:test-target|test-targets|fixtures-private|scratch|tmp)\//,
    why: 'テスト対象アプリ・私的 fixture を testworker リポにコミットしてはならない。',
  },
  {
    re: /\bgit\s+add\b/,
    check: (c) => detectAddEverything(c),
    why: 'git add で「リポルート / カレントディレクトリ丸ごと」相当 (-A / --all / . / ./ / :/ / :(top) など) は禁止。明示的にファイル指定すること。',
  },
  {
    re: /\bcurl\s+[^|;&]*\|\s*(?:sh|bash)\b/,
    why: 'curl | sh パターンは禁止。',
  },
  {
    re: /\bwget\s+[^|;&]*\|\s*(?:sh|bash)\b/,
    why: 'wget | sh パターンは禁止。',
  },
];

for (const r of RULES) {
  if (!r.re.test(cmd)) continue;
  if (r.check && !r.check(cmd)) continue;
  block(r.why);
}

process.exit(0);
