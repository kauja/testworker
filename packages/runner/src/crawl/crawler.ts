import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  childLog,
  CrawlOptions,
  newEdgeId,
  newRunId,
  newScreenId,
  newScreenStateId,
  originSpecFromCrawlOptions,
  type Edge,
  type NavigationTrigger,
  type PageState,
  type Run,
  type RunStoppedReason,
  type Screen,
  type ScreenState,
} from '@testworker/shared';
import type { Db } from '../db/client.js';
import { existsSync } from 'node:fs';
import {
  arrivalTriggerFromNavigation,
  edgeKindForScreens,
  findScreenByNavHash,
  findScreenStateByIdentity,
  findPageStateBySignature,
  insertConsoleBatch,
  insertEdge,
  insertErrorBatch,
  insertErrorContextBatch,
  insertNetworkBatch,
  insertRun,
  updateRunHarPath,
  updateRunProgress,
  updateRunStatus,
  upsertPageState,
  upsertScreen,
  upsertScreenState,
} from '../db/repo.js';
import { computeSignature } from './signature.js';
import { collectInteractions, type Interaction } from './interactions.js';
import { collectErrorContexts, installRootCauseRecorder } from './error-context.js';
import { applyPageStateId, createMonitors } from './monitors.js';
import { collectWebVitals, installWebVitals } from './web-vitals.js';
import { applyCacheMode } from './cache.js';
import { applyThrottling } from './throttle.js';
import { loadLoginScript } from '../auth/login.js';
import { createRobotsCache, isAllowedByRobots } from './robots.js';
import { autoScroll } from './auto-scroll.js';
import { hasResourceBlocking, installResourceBlocking } from './resource-block.js';
import { loadInjectScript } from './inject.js';
import { resolveDeviceProfile } from './devices.js';
import { isAllowedOrigin } from './origin-spec.js';
import { evaluateSafetyCaps, evaluateStopConditions, type StopMetrics } from './stop-conditions.js';

const DEFAULT_ROBOTS_UA = 'testworker';

export interface CrawlReport {
  run: Run;
  pages: number;
  edges: number;
}

interface Frontier {
  fromPageStateId: string | null;
  fromScreenId: string | null;
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
  const parsedOptions = CrawlOptions.parse(rawOptions);
  const originSpec = originSpecFromCrawlOptions(parsedOptions);
  const options: CrawlOptions = {
    ...parsedOptions,
    originSpec,
  };
  const runId = newRunId();
  const startedAt = new Date().toISOString();
  // child logger に runId を bake して、 全 log 行に runId を載せる (Issue #92)。
  const clog = childLog({ runId });
  const run: Run = {
    id: runId,
    appId: null,
    startUrl: options.startUrl,
    status: 'running',
    startedAt,
    finishedAt: null,
    options,
    errorMessage: null,
    origin: options.runOrigin,
    stoppedReason: null,
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
  let pageErrorCount = 0;
  let networkFailCount = 0;
  let screenshotCount = 0;
  let stableSteps = 0;
  let stoppedReason: RunStoppedReason | null = null;
  const startedMs = Date.parse(startedAt);

  try {
    // Issue #196: deviceProfile を 1 回だけ解決し、 newContext と
    // pageState.viewport の両方で同じ値を使う (画面とメタの不一致を防ぐ)。
    const device = resolveDeviceProfile(options);
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      viewport: device.viewport,
      userAgent: device.userAgent,
      deviceScaleFactor: device.deviceScaleFactor,
      isMobile: device.isMobile,
      hasTouch: device.hasTouch,
      storageState: options.storageStatePath,
      recordHar: { path: harAbsPath, mode: 'minimal' },
    });
    if (options.captureWebVitals) {
      await installWebVitals(context);
    }
    await installRootCauseRecorder(context);
    // Issue #202: analytics / ads / font 等の不要リソースを abort する。
    // 何もブロックしない既定 run では route を登録しない (interception 無し = 完全後方互換)。
    if (hasResourceBlocking(options)) {
      await installResourceBlocking(context, options);
    }

    // Issue #203: カスタム JS 注入フック。 context.addInitScript はコンテキスト全体に
    // 登録され、 以降生成される全ページ・全ナビゲーションで「ページ評価前」に毎回走る。
    // login script より前に登録することでログイン画面も含め全評価前に注入される。
    // 内容はブラウザのページコンテキストで実行 (Node ホストでは実行しない)。
    if (options.injectScriptPath) {
      const injectSource = await loadInjectScript(options.injectScriptPath);
      await context.addInitScript(injectSource);
    }

    const monitors = createMonitors();
    monitors.bindContext(context);

    const page = await context.newPage();
    monitors.attach(page);
    page.setDefaultNavigationTimeout(options.navTimeoutMs);

    // Issue #205: cacheMode を CDP で適用 (warm は no-op)。 cold は login 前に
    // ブラウザキャッシュ + Cookie をクリアするので、 storageState ではなく loginScript と
    // 組み合わせる前提。 CDP は Chromium 限定 / 失敗しても巡回は続行する (fail-open)。
    try {
      await applyCacheMode(context, page, options.cacheMode);
    } catch (err) {
      clog.warn(
        { err: (err as Error).message, cacheMode: options.cacheMode },
        'applyCacheMode failed',
      );
    }
    // Issue #197: Network / CPU throttling を CDP 経由で適用。 throttling 不要なら
    // (networkThrottle:'none' かつ cpuThrottle:1) 何もしない。 login script より前に
    // 適用して、 認証フローも絞られた条件下で走らせる。
    await applyThrottling(page, {
      networkThrottle: options.networkThrottle,
      cpuThrottle: options.cpuThrottle,
    });

    if (options.loginScriptPath) {
      const login = await loadLoginScript(options.loginScriptPath);
      await login({ page, context });
    }

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
        fromScreenId: null,
        fromUrl: null,
        depth: 0,
        url: options.startUrl,
        trigger: 'initial',
        triggerSelector: null,
        triggerText: null,
      },
    ];

    while (frontier.length > 0) {
      const task = frontier.shift()!;
      const preStepStop = evaluateStopState({
        options,
        startedMs,
        pageCount,
        pageErrorCount,
        networkFailCount,
        screenshotCount,
        stableSteps,
        currentUrl: null,
        nextDepth: task.depth,
        selectorFound: false,
      });
      if (preStepStop) {
        stoppedReason = preStepStop;
        break;
      }
      // Issue #86: 走行中の進捗を runs テーブルに書き戻して Web UI から見える状態にする。
      // BFS ループ先頭で 1 ページごとに UPDATE 1 本だけ。 task が同 origin / robots /
      // include-exclude で弾かれても currentUrl は「次に試行している URL」として正しい。
      updateRunProgress(db, runId, pageCount, frontier.length + 1, task.url);
      if (!isAllowedOrigin(task.url, originSpec, options.startUrl)) continue;
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
      // post-goto の scope check (Issue #93 / #182)。 pre-goto は task.url で
      // 弾くが、 30x で別 origin に redirect された場合は page.url() を改めて判定する。
      if (!isAllowedOrigin(page.url(), originSpec, options.startUrl)) {
        clog.warn({ from: task.url, to: page.url() }, 'out-of-scope redirect skipped');
        monitors.rotate();
        continue;
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
      const existingState = findScreenStateByIdentity(db, runId, sig.navHash, sig.structureHash);
      const existingPage = findPageStateBySignature(db, runId, sig.signature);
      const exists = existingState ?? existingPage;
      const isRevisit = exists !== undefined;
      const screenId =
        existingState?.screenId ?? findScreenByNavHash(db, runId, sig.navHash)?.id ?? newScreenId();
      const pageStateId = exists?.id ?? newScreenStateId();

      if (isRevisit) {
        stableSteps += 1;
        // 同一 signature の再訪は upsertPageState の ON CONFLICT で error_count が
        // 加算され、 console/network/page_errors も毎回 INSERT されて重複する。
        // edge だけ作って snapshot は破棄する。
        monitors.rotate();

        if (task.fromPageStateId && task.fromPageStateId !== pageStateId) {
          const edge: Edge = {
            id: newEdgeId(),
            runId,
            fromStateId: task.fromPageStateId,
            toStateId: pageStateId,
            kind:
              task.fromScreenId && existingState
                ? edgeKindForScreens(task.fromScreenId, existingState.screenId)
                : 'nav',
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
        const revisitStop = evaluateStopState({
          options,
          startedMs,
          pageCount,
          pageErrorCount,
          networkFailCount,
          screenshotCount,
          stableSteps,
          currentUrl: sig.url,
          nextDepth: task.depth,
          selectorFound: await selectorExists(page, options.stopConditions.untilSelector),
        });
        if (revisitStop) {
          stoppedReason = revisitStop;
          break;
        }
        continue;
      }

      const screenshotPath = join('runs', runId, 'screenshots', `${pageStateId}.png`);
      const absScreenshot = join(dataDir, screenshotPath);
      try {
        await page.screenshot({ path: absScreenshot, fullPage: false });
        screenshotCount += 1;
      } catch (err) {
        clog.warn({ err: (err as Error).message, pageStateId }, 'screenshot failed');
      }

      const snap = monitors.rotate();
      const consoleEntries = applyPageStateId(snap.console, pageStateId);
      const networkEntries = applyPageStateId(snap.network, pageStateId);
      const pageErrors = applyPageStateId(snap.errors, pageStateId);
      const consoleErrCount = consoleEntries.filter((c) => c.level === 'error').length;
      const networkErrCount = networkEntries.filter(
        (n) => n.failed || (n.status ?? 0) >= 400,
      ).length;
      const errCount = pageErrors.length;
      pageErrorCount += errCount;
      networkFailCount += networkErrCount;
      const metrics = options.captureWebVitals ? await collectWebVitals(page) : {};
      const errorContexts = await collectErrorContexts({
        page,
        context,
        dataDir,
        runId,
        pageStateId,
        errors: pageErrors,
        consoleEntries,
        networkEntries,
        options,
      });

      const screen: Screen = {
        id: screenId,
        runId,
        url: sig.url,
        pathname: sig.pathname,
        title: sig.title,
        navHash: sig.navHash,
      };
      upsertScreen(db, screen);

      const screenState: ScreenState = {
        id: pageStateId,
        runId,
        screenId,
        structureHash: sig.structureHash,
        arrivalTrigger: arrivalTriggerFromNavigation(task.trigger),
        arrivalSelector: task.triggerSelector,
      };
      upsertScreenState(db, screenState);

      const pageState: PageState = {
        id: pageStateId,
        runId,
        url: sig.url,
        title: sig.title,
        signature: sig.signature,
        depth: task.depth,
        visitedAt: new Date().toISOString(),
        screenshotPath,
        viewport: device.viewport,
        errorCount: errCount,
        consoleErrorCount: consoleErrCount,
        networkErrorCount: networkErrCount,
        metrics,
      };
      upsertPageState(db, pageState);
      insertConsoleBatch(db, consoleEntries);
      insertNetworkBatch(db, networkEntries);
      insertErrorBatch(db, pageErrors);
      insertErrorContextBatch(db, errorContexts);

      pageCount += 1;
      stableSteps = 0;

      if (task.fromPageStateId && task.fromPageStateId !== pageStateId) {
        const edge: Edge = {
          id: newEdgeId(),
          runId,
          fromStateId: task.fromPageStateId,
          toStateId: pageStateId,
          kind: task.fromScreenId ? edgeKindForScreens(task.fromScreenId, screenId) : 'nav',
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

      const postStepStop = evaluateStopState({
        options,
        startedMs,
        pageCount,
        pageErrorCount,
        networkFailCount,
        screenshotCount,
        stableSteps,
        currentUrl: sig.url,
        nextDepth: task.depth,
        selectorFound: await selectorExists(page, options.stopConditions.untilSelector),
      });
      if (postStepStop) {
        stoppedReason = postStepStop;
        break;
      }

      if (task.depth >= options.maxDepth) continue;

      const interactions = await collectInteractions(page);
      for (const it of interactions) {
        const nextUrl = resolveNextUrl(page.url(), it);
        if (!nextUrl) continue;
        if (frontierUrls.has(nextUrl)) continue;
        frontierUrls.add(nextUrl);
        frontier.push({
          fromPageStateId: pageStateId,
          fromScreenId: screenId,
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
    const finishedAt = new Date().toISOString();
    updateRunStatus(db, runId, 'completed', finishedAt, null, stoppedReason);
    return {
      run: {
        ...run,
        status: 'completed',
        finishedAt,
        origin: options.runOrigin,
        stoppedReason,
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
    updateRunStatus(db, runId, 'failed', new Date().toISOString(), message, 'crashed');
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

function evaluateStopState(params: {
  options: CrawlOptions;
  startedMs: number;
  pageCount: number;
  pageErrorCount: number;
  networkFailCount: number;
  screenshotCount: number;
  stableSteps: number;
  currentUrl: string | null;
  nextDepth: number | null;
  selectorFound: boolean;
}): RunStoppedReason | null {
  const metrics: StopMetrics = {
    elapsedMs: Date.now() - params.startedMs,
    nextDepth: params.nextDepth,
    pageCount: params.pageCount,
    pageErrorCount: params.pageErrorCount,
    networkFailCount: params.networkFailCount,
    screenshotCount: params.screenshotCount,
    stableSteps: params.stableSteps,
    currentUrl: params.currentUrl,
    selectorFound: params.selectorFound,
  };
  const explicit = evaluateStopConditions(params.options.stopConditions, metrics);
  if (explicit.shouldStop) return explicit.reason;
  const safety = evaluateSafetyCaps(params.options, metrics);
  return safety.shouldStop ? safety.reason : null;
}

async function selectorExists(page: Page, selector: string | undefined): Promise<boolean> {
  if (!selector) return false;
  try {
    return (await page.locator(selector).count()) > 0;
  } catch {
    return false;
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
