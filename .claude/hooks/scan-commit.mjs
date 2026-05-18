#!/usr/bin/env node
/**
 * PostToolUse(Bash) hook.
 *
 * `git commit` の直後に gitleaks 風の簡易スキャンをかけ、
 * 秘密情報パターンが直近 commit に含まれていたら警告（block ではなく可視化）。
 *
 * gitleaks 本体は CI で動かす。これはローカルの早期警告。
 */

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const payload = JSON.parse(readFileSync(0, 'utf-8'));
const cmd = String(payload?.tool_input?.command ?? '');
if (!/\bgit\s+commit\b/.test(cmd)) process.exit(0);

let diff = '';
try {
  diff = execSync('git show --no-color --unified=0 HEAD', { encoding: 'utf-8' });
} catch {
  process.exit(0);
}

const PATTERNS = [
  { name: 'AWS access key', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub PAT', re: /ghp_[A-Za-z0-9]{30,}/ },
  { name: 'GitHub OAuth', re: /gho_[A-Za-z0-9]{30,}/ },
  { name: 'OpenAI/Anthropic key', re: /sk-[A-Za-z0-9-_]{20,}/ },
  { name: 'Slack token', re: /xox[abprs]-[A-Za-z0-9-]{10,}/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Google API key', re: /AIza[0-9A-Za-z\\-_]{35}/ },
];

const hits = [];
for (const p of PATTERNS) {
  if (p.re.test(diff)) hits.push(p.name);
}

if (hits.length > 0) {
  process.stderr.write(
    `[harness] WARNING: 直近 commit に秘密情報らしきパターンが検出: ${hits.join(', ')}\n` +
      `  直ちに git reset --soft HEAD~1 して履歴を作り直すか、人手で対処してください（push 前であれば回復可能）。\n`,
  );
}

process.exit(0);
