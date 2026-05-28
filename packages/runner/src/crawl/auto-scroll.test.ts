import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import { CrawlOptions } from '@testworker/shared';
import { autoScroll } from './auto-scroll.js';

/**
 * Issue #199 の最小検証:
 *   1. CrawlOptions が autoScroll 系 field を後方互換 default で解釈する
 *   2. autoScroll helper が「高さが伸びる間はスクロールし、 最下部で停止」「maxSteps で打ち切る」
 */

const SCROLL_RE = /scrollBy/;
const MEASURE_RE = /scrollHeight:/;

interface ScrollMetrics {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

/**
 * scripted な scroll 状態列を返す fake Page。 scrollBy のたびに 1 つ前進し、
 * measure script ではその時点の metrics を返す。 evaluate / waitForTimeout だけ実装。
 */
function makeFakePage(states: ScrollMetrics[]): {
  page: Page;
  scrollCalls: () => number;
  waitCalls: () => number;
} {
  let index = 0;
  let scrollCalls = 0;
  let waitCalls = 0;
  const page = {
    async evaluate(script: string): Promise<unknown> {
      if (SCROLL_RE.test(script)) {
        scrollCalls += 1;
        if (index < states.length - 1) index += 1;
        return undefined;
      }
      if (MEASURE_RE.test(script)) {
        return states[Math.min(index, states.length - 1)];
      }
      return undefined;
    },
    async waitForTimeout(): Promise<void> {
      waitCalls += 1;
    },
  } as unknown as Page;
  return { page, scrollCalls: () => scrollCalls, waitCalls: () => waitCalls };
}

describe('CrawlOptions autoScroll defaults', () => {
  it('defaults to disabled with safe step/delay', () => {
    const opts = CrawlOptions.parse({ startUrl: 'https://example.com' });
    expect(opts.autoScroll).toBe(false);
    expect(opts.autoScrollMaxSteps).toBe(10);
    expect(opts.autoScrollDelayMs).toBe(400);
  });

  it('accepts explicit overrides within bounds', () => {
    const opts = CrawlOptions.parse({
      startUrl: 'https://example.com',
      autoScroll: true,
      autoScrollMaxSteps: 25,
      autoScrollDelayMs: 0,
    });
    expect(opts.autoScroll).toBe(true);
    expect(opts.autoScrollMaxSteps).toBe(25);
    expect(opts.autoScrollDelayMs).toBe(0);
  });

  it('rejects out-of-range step counts', () => {
    expect(() =>
      CrawlOptions.parse({ startUrl: 'https://example.com', autoScrollMaxSteps: 0 }),
    ).toThrow();
    expect(() =>
      CrawlOptions.parse({ startUrl: 'https://example.com', autoScrollMaxSteps: 1000 }),
    ).toThrow();
  });
});

describe('autoScroll helper', () => {
  it('stops early once the page reaches a stable bottom', async () => {
    // 高さは伸びず、 最初から最下部 (scrollTop + clientHeight >= scrollHeight)。
    // → 2 連続 stagnant で 2 step 目で break する。
    const states: ScrollMetrics[] = [{ scrollTop: 200, scrollHeight: 1000, clientHeight: 800 }];
    const { page, scrollCalls } = makeFakePage(states);
    await autoScroll(page, { maxSteps: 50, delayMs: 0 });
    // 1 step 目は prevHeight 初期値 -1 に対して必ず grew=true、 以後 2 連続 stagnant で break。
    expect(scrollCalls()).toBe(3);
  });

  it('keeps scrolling while content grows then stops', async () => {
    // 各 scrollBy で高さが伸びていく (infinite scroll) → 伸び止まり最下部で停止。
    const states: ScrollMetrics[] = [
      { scrollTop: 800, scrollHeight: 1600, clientHeight: 800 },
      { scrollTop: 1600, scrollHeight: 2400, clientHeight: 800 },
      { scrollTop: 2400, scrollHeight: 3200, clientHeight: 800 },
      // 以降は伸びず最下部 → stagnant 2 連続で break
      { scrollTop: 2400, scrollHeight: 3200, clientHeight: 800 },
    ];
    const { page, scrollCalls } = makeFakePage(states);
    await autoScroll(page, { maxSteps: 50, delayMs: 0 });
    // 3 回伸びて step を進め、 4 状態目で 2 連続 stagnant → 合計スクロール回数は states 長 + stagnant 分
    expect(scrollCalls()).toBeGreaterThanOrEqual(4);
    expect(scrollCalls()).toBeLessThan(50);
  });

  it('caps at maxSteps when content never stabilizes', async () => {
    // 毎回高さが伸び続ける (永遠に grow) → maxSteps で打ち切り。
    let h = 1000;
    const growing: Page = {
      async evaluate(script: string): Promise<unknown> {
        if (MEASURE_RE.test(script)) {
          h += 800;
          return { scrollTop: 0, scrollHeight: h, clientHeight: 800 };
        }
        return undefined;
      },
      async waitForTimeout(): Promise<void> {},
    } as unknown as Page;
    let calls = 0;
    const orig = growing.evaluate.bind(growing);
    growing.evaluate = (async (script: string) => {
      if (SCROLL_RE.test(script)) calls += 1;
      return orig(script);
    }) as Page['evaluate'];
    await autoScroll(growing, { maxSteps: 5, delayMs: 0 });
    expect(calls).toBe(5);
  });
});
