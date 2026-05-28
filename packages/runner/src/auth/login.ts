import { existsSync, realpathSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BrowserContext, Page } from 'playwright';

/**
 * ログインフロー定義の契約。
 *
 * ユーザは `login.ts` を 1 ファイル書き、`default export` で関数を渡す。
 * 例:
 *   export default async function login({ page }) {
 *     await page.goto('https://example.com/login');
 *     await page.fill('#email', process.env.LOGIN_EMAIL!);
 *     await page.fill('#password', process.env.LOGIN_PASSWORD!);
 *     await page.click('button[type=submit]');
 *     await page.waitForLoadState('networkidle');
 *   }
 */
export type LoginFn = (args: { page: Page; context: BrowserContext }) => Promise<void>;

// CLI / env から渡された任意 path を `await import(...)` させると、 symlink 経由の
// 任意ファイル読み込み・拡張子偽装・リポジトリ外コード実行が成立し、 OSS としての
// 攻撃ベクタになる (Issue #58)。 sandbox dir 配下に強制する。
// 環境変数 TESTWORKER_LOGIN_SCRIPTS_DIR で上書き可能、 default は `<cwd>/auth`。
const ALLOWED_EXTENSIONS = new Set(['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs']);

function loginScriptsDir(): string {
  const raw = process.env.TESTWORKER_LOGIN_SCRIPTS_DIR ?? resolve(process.cwd(), 'auth');
  return realpathSync(resolve(raw));
}

export async function loadLoginScript(path: string): Promise<LoginFn> {
  if (!existsSync(path)) {
    throw new Error(`login script not found: ${path}`);
  }
  // 拡張子チェック (resolve 前の入力で評価して misleading な name を弾く)。
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `login script must have one of [${[...ALLOWED_EXTENSIONS].join(', ')}] extension: ${path}`,
    );
  }
  // symlink 解決後の path が sandbox 配下に収まっているか検査。 raw startsWith では
  // `auth-other/x.ts` のような sibling-prefix bypass や symlink 脱出が通る。
  const sandbox = loginScriptsDir();
  const realPath = realpathSync(resolve(path));
  const sandboxWithSep = sandbox.endsWith(sep) ? sandbox : sandbox + sep;
  if (realPath !== sandbox && !realPath.startsWith(sandboxWithSep)) {
    throw new Error(
      `login script must be inside ${sandbox} (resolved to ${realPath}). ` +
        `Set TESTWORKER_LOGIN_SCRIPTS_DIR to move the sandbox.`,
    );
  }
  const mod = (await import(pathToFileURL(realPath).href)) as { default?: LoginFn };
  if (typeof mod.default !== 'function') {
    throw new Error(`login script must export default async function: ${path}`);
  }
  return mod.default;
}
