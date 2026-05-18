import { existsSync } from 'node:fs';
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

export async function loadLoginScript(path: string): Promise<LoginFn> {
  if (!existsSync(path)) {
    throw new Error(`login script not found: ${path}`);
  }
  const mod = (await import(pathToFileURL(path).href)) as { default?: LoginFn };
  if (typeof mod.default !== 'function') {
    throw new Error(`login script must export default async function: ${path}`);
  }
  return mod.default;
}
