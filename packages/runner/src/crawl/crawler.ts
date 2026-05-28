import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  childLog,
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
import { existsSync } from 'node:fs';
import {
  findPageStateBySignature,
  insertConsoleBatch,
  insertEdge,
  insertErrorBatch,
  insertNetworkBatch,
  insertRun,
  updateRunHarPath,
  updateRunProgress,
  updateRunStatus,
  upsertPageState,
} from '../db/repo.js';
import { computeSignature } from './signature.js';
import { collectInteractions, type Interaction } from './interactions.js';
import { applyPageStateId, createMonitors } from './monitors.js';
import { collectWebVitals, installWebVitals } from './web-vitals.js';
import { loadLoginScript } from '../auth/login.js';
import { createRobotsCache, isAllowedByRobots } from './robots.js';
import { autoScroll } from './auto-scroll.js';
import { hasResourceBlocking, installResourceBlocking } from './resource-block.js';

const DEFAULT_ROBOTS_UA = 'testworker';

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
  // child logger に runId を bake して、 全 log 行に runId を載せる (Issue #92)。
  const clog = childLog({ runId });
  const run: Run = {
    id: runId,
    startUrl: options.startUrl,
    status: 'running',
    startedAt,
    finishedAt: null,
    options,
    errorMessage: null,
    pagesDone: 0,
    queueSize: 1,
    currentUrl: options.startUrl,
    harPath: null,
  };
  insertRun(db, run);
  await mkdir(join(dataDir, 'runs', runId, 'screenshots'), { recursive: true });

  // Issue #87: Playwright の recordHar で HAR を保存する。 DATA_DIR 配下に置き、
  // 完了時に runs.har_path にパスを書き込む。 mode:'minimal' で response body は
  // 保存しない (PII / 容量爆発の回避)。
  const harRelPath = join('runs', runId, 'network.har');
  const harAbsPath = join(dataDir, harRelPath);

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
      recordHar: { path: harAbsPath, mode: 'minimal' },
    });
    if (options.captureWebVitals) {
      await installWebVitals(context);
    }
    // Issue #202: analytics / ads / font 等の不要リソースを abort する。
    // 何もブロックしない既定 run では route を登録しない (interception 無し = 完全後方互換)。
    if (hasResourceBlocking(options)) {
      await installResourceBlocking(context, options);
    }

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
    // robots.txt キャッシュ。 origin ごとに 1 回だけ fetch。 fail-open。
    const robotsUserAgent = options.userAgent ?? DEFAULT_ROBOTS_UA;
    const getRobots = options.respectRobots ? createRobotsCache(robotsUserAgent) : null;
    // frontier に投げる URL は post-goto で resolve した値で dedup する。
    // 旧実装は signature ベース dedup のみで、 SPA の共通 header/footer 由来の
    // 同一リンクがページ毎に何度も frontier に積まれ、 O(N×M) 回 goto / monitor /
    // screenshot が走って時間と DB エントリが膨張していた (Issue #94)。
    const frontierUrls = new Set<string>();
    frontierUrls.add(options.startUrl);
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
      // Issue #86: 走行中の進捗を runs テーブルに書き戻して Web UI から見える状態にする。
      // BFS ループ先頭で 1 ページごとに UPDATE 1 本だけ。 task が同 origin / robots /
      // include-exclude で弾かれても currentUrl は「次に試行している URL」として正しい。
      updateRunProgress(db, runId, pageCount, frontier.length + 1, task.url);
      if (task.depth > options.maxDepth) continue;
      if (options.sameOriginOnly) {
        try {
          if (new URL(task.url).origin !== startOrigin) continue;
        } catch {
          continue;
        }
      }
      if (!urlMatches(task.url, options)) continue;

      // robots.txt の Disallow に該当する URL は queue から落とす (Issue #101)。
      // 同一 origin 制約と組み合わせる前提で、 origin ごとに 1 回 fetch。
      // robots.txt 自体が取れない / 404 / timeout の場合は fail-open。
      if (getRobots) {
        let taskOrigin: string | null = null;
        let taskPath = '/';
        try {
          const u = new URL(task.url);
          taskOrigin = u.origin;
          taskPath = u.pathname + u.search;
        } catch {
          continue;
        }
        const rules = await getRobots(taskOrigin);
        if (!isAllowedByRobots(rules, taskPath)) {
          clog.warn({ url: task.url }, 'skipped by robots.txt');
          continue;
        }
      }

      try {
        await page.goto(task.url, { waitUntil: options.waitStrategy });
      } catch (err) {
        clog.warn({ url: task.url, err: (err as Error).message }, 'nav failed');
        // 失敗した遷移中に発生した console / pageerror / request イベントが
        // 次の成功ページの snapshot に紛れ込むのを防ぐため、 buffer を破棄。
        monitors.rotate();
        continue;
      }
      // post-goto の same-origin check (Issue #93)。 pre-goto は task.url で
      // 弾くが、 30x で外部 origin に redirect された場合は page.url() が startOrigin
      // と一致しない。 sameOriginOnly が有効なら破棄して continue。
      if (options.sameOriginOnly) {
        let landedOrigin: string | null = null;
        try {
          landedOrigin = new URL(page.url()).origin;
        } catch {
          landedOrigin = null;
        }
        if (landedOrigin !== startOrigin) {
          clog.warn({ from: task.url, to: page.url() }, 'cross-origin redirect skipped');
          monitors.rotate();
          continue;
        }
      }
      if (options.waitAfterNavMs > 0) {
        await page.waitForTimeout(options.waitAfterNavMs);
      }
      // infinite scroll / lazy load を発火させてから signature / screenshot を取る (Issue #199)。
      if (options.autoScroll) {
        await autoScroll(page, {
          maxSteps: options.autoScrollMaxSteps,
          delayMs: options.autoScrollDelayMs,
        });
      }

      const sig = await computeSignature(page);
      const exists = findPageStateBySignature(db, runId, sig.signature);
      const isRevisit = exists !== undefined;
      const pageStateId = exists?.id ?? newPageStateId();

      if (isRevisit) {
        // 同一 signature の再訪は upsertPageState の ON CONFLICT で error_count が
        // 加算され、 console/network/page_errors も毎回 INSERT されて重複する。
        // edge だけ作って snapshot は破棄する。
        monitors.rotate();

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
        continue;
      }

      const screenshotPath = join('runs', runId, 'screenshots', `${pageStateId}.png`);
      const absScreenshot = join(dataDir, screenshotPath);
      try {
        await page.screenshot({ path: absScreenshot, fullPage: false });
      } catch (err) {
        clog.warn({ err: (err as Error).message, pageStateId }, 'screenshot failed');
      }

      const snap = monitors.rotate();
      const consoleErrCount = snap.console.filter((c) => c.level === 'error').length;
      const networkErrCount = snap.network.filter((n) => n.failed || (n.status ?? 0) >= 400).length;
      const errCount = snap.errors.length;
      const metrics = options.captureWebVitals ? await collectWebVitals(page) : {};

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
        metrics,
      };
      upsertPageState(db, pageState);
      insertConsoleBatch(db, applyPageStateId(snap.console, pageStateId));
      insertNetworkBatch(db, applyPageStateId(snap.network, pageStateId));
      insertErrorBatch(db, applyPageStateId(snap.errors, pageStateId));

      pageCount += 1;

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

      visitedSignatures.add(sig.signature);

      if (task.depth >= options.maxDepth) continue;

      const interactions = await collectInteractions(page);
      for (const it of interactions) {
        const nextUrl = resolveNextUrl(page.url(), it);
        if (!nextUrl) continue;
        if (frontierUrls.has(nextUrl)) continue;
        frontierUrls.add(nextUrl);
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

    // 完了時に最終 progress を確定。 currentUrl は null (now idle)。
    updateRunProgress(db, runId, pageCount, 0, null);
    updateRunStatus(db, runId, 'completed', new Date().toISOString(), null);
    return {
      run: {
        ...run,
        status: 'completed',
        finishedAt: new Date().toISOString(),
        pagesDone: pageCount,
        queueSize: 0,
        currentUrl: null,
      },
      pages: pageCount,
      edges: edgeCount,
    };
  } catch (err) {
    const message = (err as Error).message;
    // failed 時も進捗の最終値を残しておくと UI で「N/M で失敗」が見える。
    updateRunProgress(db, runId, pageCount, 0, null);
    updateRunStatus(db, runId, 'failed', new Date().toISOString(), message);
    throw err;
  } finally {
    // recordHar の flush は context.close() 内で実行されるので、 必ず close →
    // ファイル存在を確認 → runs.har_path に書く、 の順で行う。 失敗時でも
    // context.close() を待つことで部分的な HAR が書き出される。
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      if (existsSync(harAbsPath)) {
        updateRunHarPath(db, runId, harRelPath);
      }
    } catch (err) {
      clog.warn({ err: (err as Error).message }, 'HAR path update failed');
    }
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
