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
const rawCmd = String(payload?.tool_input?.command ?? '');

function block(reason) {
  process.stderr.write(`[harness] BLOCKED: ${reason}\nCommand:\n  ${rawCmd}\n`);
  process.exit(2);
}

/**
 * `git -C <path>` `git --no-pager` `git -c key=val` などの global option を
 * subcommand の直前から除去し、 既存 rule (`\bgit\s+push\b` 等) が
 * subcommand を捕まえられるよう正規化する。 これがないと
 *   git -C /tmp push origin main
 *   git --no-pager push origin main
 *   git -c safe.directory=/tmp push --force origin main
 * のような global option 経由で全 rule を素通りする (7R critical)。
 *
 * パターン:
 *   - `-C <path>` / `-c <key=val>`  : space-separated 2 token を 1 単位
 *   - `--git-dir=<path>` / `--work-tree=<path>` / `--no-pager` / `--exec-path=` 等
 *   - `-P` / `-p` / `-v` などの 1 文字 flag
 *   - `--namespace=<x>` 等の `--key=value` 形式
 */
function normalizeGit(text) {
  return text.replace(
    /\bgit((?:\s+(?:-[Cc]\s+\S+|-[A-Za-z]+|--[A-Za-z][A-Za-z0-9-]*(?:=\S+)?))+)\s+/g,
    (match, opts) => {
      // main を含む option (例: `-c branch.X.merge=refs/heads/main`) は別 rule で
      // 検出させるため preserve。 strip すると refspec override bypass が通る。
      if (/\bmain\b|refs\/heads\/main/.test(opts)) return match;
      return 'git ';
    },
  );
}

const cmd = normalizeGit(rawCmd);

/**
 * cmd を `;` `&&` `||` `|` などで区切って各セグメントの配列にする。
 * 第 1 ラウンドの実装は最初の区切りで truncate していたため、
 * `noop ; git push origin main` のような後続セグメントを検査できなかった。
 */
function splitSegments(text) {
  // subshell `$(...)` / backtick / 改行も区切り扱いにする。
  // 例: `echo $(git push origin main)` を 1 segment のままにすると、
  //   `git push origin main)` の trailing `)` で detectMainPush が
  //   target を `main)` と誤判定し block を素通りする。
  // closing paren / backtick の残骸は per-segment で末尾を strip する。
  return text
    .split(/(?:&&|\|\||;|\||&|\$\(|`|\n|\r)/)
    .map((s) =>
      s
        .trim()
        .replace(/[)`]+$/, '')
        .trim(),
    )
    .filter(Boolean);
}

/**
 * `git push ...` のセグメントから「main を target に含む」「unverifiable な bare push」
 * の両方を block する。 refs/heads/main / HEAD:main / HEAD:refs/heads/main / +main /
 * 'main' / "main" / --all / --mirror / 引数なしの `git push` を全部弾く。
 */
// read-only な push (ヘルプ表示や dry-run) は許可。 これらは ref を実際には更新しない。
const READ_ONLY_PUSH_FLAGS = new Set(['--dry-run', '-n', '--help', '-h']);

function detectMainPush(segment) {
  const m = segment.match(/\bgit\s+push\b\s*(.*)$/);
  if (!m) return false;
  const args = (m[1] ?? '').split(/\s+/).filter(Boolean);
  // read-only flag が含まれているなら ref は更新されないので素通り。
  if (args.some((a) => READ_ONLY_PUSH_FLAGS.has(a))) return false;
  const positional = args.filter((a) => !a.startsWith('-'));
  // 引数なし / bare push は target が不明 (上流が main の可能性) → block
  if (positional.length === 0) return true;
  for (const a of args) {
    // --mirror / --all は全 ref を push するため target に main を含む
    if (a === '--mirror' || a === '--all') return true;
  }
  for (const raw of positional) {
    const stripped = raw.replace(/^['"]|['"]$/g, '');
    // `HEAD` 単独は default 上流（main の可能性）を指すので block
    if (stripped === 'HEAD') return true;
    const rhs = stripped.includes(':') ? stripped.split(':').pop() : stripped;
    if (!rhs) continue;
    const target = rhs.replace(/^\+/, '').replace(/^refs\/heads\//, '');
    if (target === 'main') return true;
  }
  return false;
}

/**
 * `git add ...` で「リポルート / カレントディレクトリ丸ごと」を意味する引数を含むか判定。
 * `.`, `./`, `:/`, `:(top)`, `-A`, `--all`, `-u`, `--update`, quoted variants をカバー。
 */
function detectAddEverything(segment) {
  const m = segment.match(/\bgit\s+add\b\s*(.*)$/);
  if (!m) return false;
  const args = (m[1] ?? '').split(/\s+/).filter(Boolean);
  for (const raw of args) {
    if (raw === '--') break; // 以降は pathspec literal
    if (raw === '-A' || raw === '--all') return true;
    // `-u` / `--update` は tracked ファイル全体を stage する
    if (raw === '-u' || raw === '--update') return true;
    // `--pathspec-from-file=...` は任意リストを stage できる
    if (raw.startsWith('--pathspec-from-file')) return true;
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

/** `git commit -a` / `-am` で全 tracked file を一括 stage するのを block。 */
function detectCommitAll(segment) {
  const m = segment.match(/\bgit\s+commit\b\s*(.*)$/);
  if (!m) return false;
  const args = (m[1] ?? '').split(/\s+/).filter(Boolean);
  for (const raw of args) {
    if (raw === '--all') return true;
    // `-a` / `-am` / `-amS` のような結合フラグ。`-`+ alpha のみで、`a` を含む
    if (/^-[A-Za-z]*a[A-Za-z]*$/.test(raw)) return true;
  }
  return false;
}

/**
 * 各 RULE.check は cmd 全体ではなく、splitSegments で得た 1 セグメントを受け取って
 * true を返したら block する。これで `noop ; danger` の後続セグメントも検査できる。
 */
function anySegmentMatches(c, check) {
  for (const seg of splitSegments(c)) {
    if (check(seg)) return true;
  }
  return false;
}

const RULES = [
  // ---- main ブランチへの直接介入 ----
  {
    re: /\bgit\s+push\b/,
    check: (c) => anySegmentMatches(c, detectMainPush),
    why: 'main は保護されている。feat/* ブランチ → PR → auto-merge で進めること（target が不明な bare push, --all, --mirror も含む）。',
  },
  {
    // `git -c branch.<X>.merge=refs/heads/main push ...` で refspec を上書きする経路
    re: /\bgit\s+-c\s+\S*\.merge\s*=\s*(?:refs\/heads\/)?main\b/,
    why: 'git -c で merge refspec を main に上書きしての push は禁止（保護回避経路）。',
  },
  {
    re: /\bgit\s+commit\s+--amend\b/,
    why: 'amend はハーネス方針で禁止（こまめな commit が原則）。新しい commit を積むこと。',
  },
  {
    re: /\bgit\s+commit\b/,
    check: (c) => anySegmentMatches(c, detectCommitAll),
    why: 'git commit -a / --all は禁止（巻き込み事故・add ガード回避）。明示的に git add してから commit すること。',
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
    check: (c) => anySegmentMatches(c, detectAddEverything),
    why: 'git add で「リポルート / カレントディレクトリ丸ごと」相当 (-A / --all / -u / --update / . / ./ / :/ / :(top) / --pathspec-from-file など) は禁止。明示的にファイル指定すること。',
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
