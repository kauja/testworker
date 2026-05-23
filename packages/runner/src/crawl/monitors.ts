import type { BrowserContext, Page, Request, Response } from 'playwright';
import {
  newEventId,
  type ConsoleEntry,
  type NetworkEntry,
  type PageError,
} from '@testworker/shared';

export interface PageMonitors {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  errors: PageError[];
  attach: (page: Page) => void;
  bindContext: (ctx: BrowserContext) => void;
  /** 現在のページ用にバッファをリセット。前のページ分は保存後に呼ぶ。 */
  rotate: () => MonitorSnapshot;
}

export interface MonitorSnapshot {
  console: ConsoleEntry[];
  network: NetworkEntry[];
  errors: PageError[];
}

export function createMonitors(): PageMonitors {
  let consoleBuf: ConsoleEntry[] = [];
  let networkBuf: NetworkEntry[] = [];
  let errorsBuf: PageError[] = [];
  /** 現在割り当て中の pageStateId は確定前なのでプレースホルダーで保持し、後で埋める。 */
  const PLACEHOLDER = '__current__';

  const requestStart = new WeakMap<Request, number>();
  // Request → 直近 networkBuf に push した entry の参照。
  // `response` イベントで URL 文字列で逆引きすると、rotate 後や同一 URL の
  // 連続リクエストで取り違える。Request オブジェクトをキーにすれば確実。
  const entryByRequest = new WeakMap<Request, NetworkEntry>();

  function attach(page: Page): void {
    page.on('console', (msg) => {
      const type = msg.type();
      const level: ConsoleEntry['level'] =
        type === 'warning'
          ? 'warn'
          : ['log', 'info', 'warn', 'error', 'debug'].includes(type)
            ? (type as ConsoleEntry['level'])
            : 'log';
      const loc = msg.location();
      consoleBuf.push({
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        level,
        text: msg.text(),
        url: loc?.url || null,
        lineNumber: loc?.lineNumber ?? null,
        timestamp: new Date().toISOString(),
      });
    });

    page.on('pageerror', (err) => {
      errorsBuf.push({
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        kind: 'pageerror',
        message: err.message,
        stack: err.stack ?? null,
        timestamp: new Date().toISOString(),
      });
    });

    page.on('crash', () => {
      errorsBuf.push({
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        kind: 'crash',
        message: 'page crashed',
        stack: null,
        timestamp: new Date().toISOString(),
      });
    });

    // Playwright のイベント順は request → (response →) requestfinished / requestfailed。
    // 前回の実装は requestfinished で初めて entry を push していたため、 順序的に先に
    // 発火する response handler が WeakMap を引いても常に undefined となり、 全 network
    // entry の status / statusText が null のまま DB に書かれる重大 regression を起こして
    // いた。 ここでは request イベントで pending entry を作り、 response / requestfinished /
    // requestfailed で同じ entry を mutating で埋めていく。
    page.on('request', (req) => {
      const started = Date.now();
      requestStart.set(req, started);
      const entry: NetworkEntry = {
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        method: req.method(),
        url: req.url(),
        status: null,
        statusText: null,
        resourceType: req.resourceType(),
        startedAt: new Date(started).toISOString(),
        durationMs: null,
        fromCache: false,
        failed: false,
        failureText: null,
      };
      networkBuf.push(entry);
      entryByRequest.set(req, entry);
    });

    page.on('response', (res) => {
      const entry = entryByRequest.get(res.request());
      if (entry === undefined) return;
      entry.status = res.status();
      entry.statusText = res.statusText();
      entry.fromCache = res.fromServiceWorker();
    });

    page.on('requestfinished', (req) => {
      const entry = entryByRequest.get(req);
      const started = requestStart.get(req);
      if (entry === undefined || started === undefined) return;
      entry.durationMs = Date.now() - started;
    });

    page.on('requestfailed', (req) => {
      const entry = entryByRequest.get(req);
      const started = requestStart.get(req);
      if (entry !== undefined) {
        entry.failed = true;
        entry.failureText = req.failure()?.errorText ?? null;
        if (started !== undefined) entry.durationMs = Date.now() - started;
        return;
      }
      // 念のため: request イベントを観測せず failed だけ届く稀ケースのフォールバック。
      networkBuf.push({
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        method: req.method(),
        url: req.url(),
        status: null,
        statusText: null,
        resourceType: req.resourceType(),
        startedAt: new Date(started ?? Date.now()).toISOString(),
        durationMs: started ? Date.now() - started : null,
        fromCache: false,
        failed: true,
        failureText: req.failure()?.errorText ?? null,
      });
    });
  }

  function bindContext(ctx: BrowserContext): void {
    ctx.on('weberror', (err) => {
      errorsBuf.push({
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        kind: 'unhandledrejection',
        message: err.error().message,
        stack: err.error().stack ?? null,
        timestamp: new Date().toISOString(),
      });
    });
  }

  function rotate(): MonitorSnapshot {
    const snap = { console: consoleBuf, network: networkBuf, errors: errorsBuf };
    consoleBuf = [];
    networkBuf = [];
    errorsBuf = [];
    return snap;
  }

  return {
    get console() {
      return consoleBuf;
    },
    get network() {
      return networkBuf;
    },
    get errors() {
      return errorsBuf;
    },
    attach,
    bindContext,
    rotate,
  };
}

export function applyPageStateId<T extends { pageStateId: string }>(
  items: T[],
  pageStateId: string,
): T[] {
  // mutating: monitors の response 後追い更新で entry オブジェクトを直接書き換える設計のため、
  // ここで shallow-copy するとその更新が DB insert に反映されなくなる。
  for (const item of items) item.pageStateId = pageStateId;
  return items;
}
