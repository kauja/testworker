import type { BrowserContext, Page } from 'playwright';
import type { CrawlOptions } from '@testworker/shared';

/**
 * Issue #205: HTTP キャッシュ制御。 CrawlOptions.cacheMode で 3 モードを切る。
 *
 * - `warm`     — 既定。 ブラウザ既定のキャッシュ挙動 (Cache-Control 尊重)。 何もしない。
 * - `disabled` — CDP `Network.setCacheDisabled(true)` で全リクエストをキャッシュ無視
 *                させる。 毎回ネットワークから取得する (context は再利用)。
 * - `cold`     — クロール開始前にブラウザキャッシュ + Cookie を 1 回クリアし、
 *                以降は `disabled` と同じくキャッシュを無効化する。 完全に冷えた状態から
 *                巡回したいケース用。
 *
 * 副作用 (CDP / context 操作) はこの module に閉じ込め、 crawler から呼ぶ。
 */
export type CacheMode = CrawlOptions['cacheMode'];

/**
 * 当該モードで CDP の `Network.setCacheDisabled` に渡すべき値。
 * 純関数 (テスト対象)。 `warm` のみキャッシュ有効 (= disabled:false)。
 */
export function cacheDisabledFlag(mode: CacheMode): boolean {
  return mode !== 'warm';
}

/** `cold` モードのみ、 開始前にブラウザキャッシュ / Cookie のクリアが要る。 */
export function needsColdReset(mode: CacheMode): boolean {
  return mode === 'cold';
}

/**
 * page (とその context) に cacheMode を適用する。
 * - `warm` は no-op。
 * - それ以外は CDP セッションを開いて `Network.setCacheDisabled` を立てる。
 * - `cold` はさらに `Network.clearBrowserCache` と `context.clearCookies()` を 1 回実行。
 *
 * CDP は Chromium 限定。 失敗しても巡回自体は続行できるよう、 呼び出し側で握りつぶす想定。
 */
export async function applyCacheMode(
  context: BrowserContext,
  page: Page,
  mode: CacheMode,
): Promise<void> {
  if (mode === 'warm') return;

  const session = await context.newCDPSession(page);
  if (needsColdReset(mode)) {
    await session.send('Network.clearBrowserCache');
    await context.clearCookies();
  }
  await session.send('Network.setCacheDisabled', { cacheDisabled: cacheDisabledFlag(mode) });
}
