import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  CrawlOptions,
  newEdgeId,
  newPageStateId,
  newRunId,
  type Edge,
  type NavigationTrigger,
  type PageState,
  type Run,
} from '@testworker/shared';
import type { Db } from '../db/client.js';
import {
  findPageStateBySignature,
  incrementPageStateCounters,
  insertConsoleBatch,
  insertEdge,
  insertErrorBatch,
  insertNetworkBatch,
  insertRun,
  updateRunStatus,
  upsertPageState,
} from '../db/repo.js';
import { computeSignature } from './signature.js';
import { collectInteractions, type Interaction } from './interactions.js';
import { applyPageStateId, createMonitors } from './monitors.js';
import { loadLoginScript } from '../auth/login.js';

export interface CrawlReport {
  run: Run;
  pages: number;
  edges: number;
}

interface Frontier {
  fromPageStateId: string | null;
  fromUrl: string | null;
  depth: number;
  url: string;
  trigger: NavigationTrigger;
  triggerSelector: string | null;
  triggerText: string | null;
}

export async function runCrawl(
  db: Db,
  dataDir: string,
  rawOptions: Partial<CrawlOptions> & { startUrl: string },
): Promise<CrawlReport> {
  const options = CrawlOptions.parse(rawOptions);
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  const run: Run = {
    id: runId,
    startUrl: options.startUrl,
    status: 'running',
    startedAt,
    finishedAt: null,
    options,
    errorMessage: null,
  };
  insertRun(db, run);
  await mkdir(join(dataDir, 'runs', runId, 'screenshots'), { recursive: true });

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let pageCount = 0;
  let edgeCount = 0;

  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: options.viewport,
      userAgent: options.userAgent,
      storageState: options.storageStatePath,
    });

    const monitors = createMonitors();
    monitors.bindContext(context);

    const page = await context.newPage();
    monitors.attach(page);
    page.setDefaultNavigationTimeout(options.navTimeoutMs);

    if (options.loginScriptPath) {
      const login = await loadLoginScript(options.loginScriptPath);
      await login({ page, context });
    }

    const startOrigin = new URL(options.startUrl).origin;
    const visitedSignatures = new Set<string>();
    const frontier: Frontier[] = [
      {
        fromPageStateId: null,
        fromUrl: null,
        depth: 0,
        url: options.startUrl,
        trigger: 'initial',
        triggerSelector: null,
        triggerText: null,
      },
    ];

    while (frontier.length > 0 && pageCount < options.maxPages) {
      const task = frontier.shift()!;
      if (task.depth > options.maxDepth) continue;
      if (options.sameOriginOnly) {
        try {
          if (new URL(task.url).origin !== startOrigin) continue;
        } catch {
          continue;
        }
      }
      if (!urlMatches(task.url, options)) continue;

      try {
        await page.goto(task.url, { waitUntil: 'load' });
      } catch (err) {
        console.warn(`[testworker] nav failed: ${task.url} (${(err as Error).message})`);
        // 失敗 nav 中に発生したイベントが次ページに混ざらないよう破棄する。
        monitors.rotate();
        continue;
      }
      if (options.waitAfterNavMs > 0) {
        await page.waitForTimeout(options.waitAfterNavMs);
      }

      const sig = await computeSignature(page);
      const exists = findPageStateBySignature(db, runId, sig.signature);
      const pageStateId = exists?.id ?? newPageStateId();
      const isNewState = !exists;
      const screenshotPath = join('runs', runId, 'screenshots', `${pageStateId}.png`);
      // 再訪時に既存スクリーンショットを破壊しないよう、新規 state のときだけ撮影する。
      if (isNewState) {
        const absScreenshot = join(dataDir, screenshotPath);
        try {
          await page.screenshot({ path: absScreenshot, fullPage: false });
        } catch (err) {
          console.warn(`[testworker] screenshot failed: ${(err as Error).message}`);
        }
      }

      // 先に少し待って pending な response / requestfinished が現バッファ内の
      // entry を mutate し終わってから rotate する。 rotate を wait の前に
      // 呼ぶと、 wait 中に発火した **新規** request イベントが空の新バッファに
      // 入って次ページ用のフレームに移ってしまう (5th-round 指摘)。
      await new Promise((resolve) => setTimeout(resolve, 50));
      const snap = monitors.rotate();

      const consoleErrCount = snap.console.filter((c) => c.level === 'error').length;
      const networkErrCount = snap.network.filter((n) => n.failed || (n.status ?? 0) >= 400).length;
      const errCount = snap.errors.length;

      if (isNewState) {
        const pageState: PageState = {
          id: pageStateId,
          runId,
          url: sig.url,
          title: sig.title,
          signature: sig.signature,
          depth: task.depth,
          visitedAt: new Date().toISOString(),
          screenshotPath,
          viewport: options.viewport,
          errorCount: errCount,
          consoleErrorCount: consoleErrCount,
          networkErrorCount: networkErrCount,
        };
        upsertPageState(db, pageState);
        pageCount += 1;
      } else {
        // 再訪時は新規 events を記録しつつ counter のみ増分する（screenshot や title は据え置き）。
        incrementPageStateCounters(db, pageStateId, errCount, consoleErrCount, networkErrCount);
      }
      // events はどちらのケースでも記録する（情報を捨てない）。
      insertConsoleBatch(db, applyPageStateId(snap.console, pageStateId));
      insertNetworkBatch(db, applyPageStateId(snap.network, pageStateId));
      insertErrorBatch(db, applyPageStateId(snap.errors, pageStateId));

      if (task.fromPageStateId && task.fromPageStateId !== pageStateId) {
        const edge: Edge = {
          id: newEdgeId(),
          runId,
          fromPageStateId: task.fromPageStateId,
          toPageStateId: pageStateId,
          trigger: task.trigger,
          triggerSelector: task.triggerSelector,
          triggerText: task.triggerText,
          createdAt: new Date().toISOString(),
        };
        insertEdge(db, edge);
        edgeCount += 1;
      }

      if (visitedSignatures.has(sig.signature)) continue;
      visitedSignatures.add(sig.signature);

      if (task.depth >= options.maxDepth) continue;

      const interactions = await collectInteractions(page);
      for (const it of interactions) {
        const nextUrl = resolveNextUrl(page.url(), it);
        if (!nextUrl) continue;
        frontier.push({
          fromPageStateId: pageStateId,
          fromUrl: page.url(),
          depth: task.depth + 1,
          url: nextUrl,
          trigger: triggerOf(it),
          triggerSelector: it.selector,
          triggerText: it.text,
        });
      }
    }

    updateRunStatus(db, runId, 'completed', new Date().toISOString(), null);
    return {
      run: { ...run, status: 'completed', finishedAt: new Date().toISOString() },
      pages: pageCount,
      edges: edgeCount,
    };
  } catch (err) {
    const message = (err as Error).message;
    updateRunStatus(db, runId, 'failed', new Date().toISOString(), message);
    throw err;
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
  }
}

function urlMatches(url: string, opts: CrawlOptions): boolean {
  if (opts.includeUrlPatterns.length > 0) {
    const ok = opts.includeUrlPatterns.some((p) => new RegExp(p).test(url));
    if (!ok) return false;
  }
  if (opts.excludeUrlPatterns.some((p) => new RegExp(p).test(url))) return false;
  return true;
}

function resolveNextUrl(baseUrl: string, it: Interaction): string | null {
  if (!it.href) {
    // ボタン等：副作用不明なので MVP では辿らない
    return null;
  }
  try {
    return new URL(it.href, baseUrl).toString();
  } catch {
    return null;
  }
}

function triggerOf(it: Interaction): NavigationTrigger {
  switch (it.kind) {
    case 'link':
      return 'link';
    case 'spa-route':
      return 'spa-route';
    case 'form-submit':
      return 'form-submit';
    case 'button':
      return 'button';
  }
}

// 静的アクセスが必要な箇所で page を直接いじりたい場合の hook（保留）。
export type { Page };
