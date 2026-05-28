import type { Page } from 'playwright';
import { log } from '@testworker/shared';

/**
 * Auto scroll for infinite scroll / lazy load (Issue #199)。
 *
 * ページ訪問後に signature / screenshot を取る前に下方向へ段階的に scrollBy し、
 * IntersectionObserver / scroll listener で発火する lazy load・infinite scroll を
 * 進める。 各ステップ後に delayMs 待って新規コンテンツの読み込みを待つ。
 *
 * 早期終了条件 (無限ループ防止):
 *   - scrollHeight が 2 ステップ連続で伸びず、 かつ最下部に到達している
 *   - maxSteps に達した
 *
 * best-effort: 例外は warn して握りつぶす (crawl 本体を止めない)。
 */
export interface AutoScrollOptions {
  maxSteps: number;
  delayMs: number;
}

const MEASURE_SCRIPT = `(() => {
  const el = document.scrollingElement || document.documentElement;
  return {
    scrollTop: el.scrollTop,
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  };
})()`;

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

const SCROLL_STEP_SCRIPT = `(() => {
  const el = document.scrollingElement || document.documentElement;
  window.scrollBy(0, el.clientHeight);
})()`;

function isScrollMetrics(value: unknown): value is ScrollMetrics {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.scrollTop === 'number' &&
    typeof v.scrollHeight === 'number' &&
    typeof v.clientHeight === 'number'
  );
}

/**
 * ページを段階的にスクロールして lazy load / infinite scroll を発火させる。
 * 完了後はトップへ戻さない (signature は安定属性ベースなので scroll 位置に依存しない、
 * screenshot は表示中の viewport を撮る既存挙動を尊重する)。
 */
export async function autoScroll(page: Page, options: AutoScrollOptions): Promise<void> {
  const maxSteps = Math.max(1, Math.floor(options.maxSteps));
  const delayMs = Math.max(0, Math.floor(options.delayMs));
  try {
    let stagnantSteps = 0;
    let prevHeight = -1;
    for (let step = 0; step < maxSteps; step += 1) {
      await page.evaluate(SCROLL_STEP_SCRIPT);
      if (delayMs > 0) {
        await page.waitForTimeout(delayMs);
      }
      const raw: unknown = await page.evaluate(MEASURE_SCRIPT);
      if (!isScrollMetrics(raw)) break;
      const atBottom = raw.scrollTop + raw.clientHeight >= raw.scrollHeight - 1;
      const grew = raw.scrollHeight > prevHeight;
      prevHeight = raw.scrollHeight;
      if (atBottom && !grew) {
        // 高さが伸びず最下部に到達 → 2 連続でループ脱出 (描画 jitter 吸収)。
        stagnantSteps += 1;
        if (stagnantSteps >= 2) break;
      } else {
        stagnantSteps = 0;
      }
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'auto scroll failed');
  }
}
