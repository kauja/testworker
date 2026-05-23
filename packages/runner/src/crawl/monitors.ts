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

    page.on('request', (req) => {
      requestStart.set(req, Date.now());
    });

    page.on('requestfailed', (req) => {
      const started = requestStart.get(req);
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

    // requestfinished に sync ハンドラで entry を push する。
    // `await req.response()` を挟むと、その間に rotate() が走った場合に
    // 古い entry が次ページのバッファに紛れ込む race を起こす（#39）。
    // status は `response` イベントで遅延更新する。
    page.on('requestfinished', (req) => {
      const started = requestStart.get(req);
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
        failed: false,
        failureText: null,
      });
    });

    page.on('response', (res) => {
      // 同じ URL の最新 entry を遡って status / fromCache を埋める。
      // rotate 後の到着は別バッファになるので、現在の networkBuf だけ見れば良い。
      const url = res.url();
      for (let i = networkBuf.length - 1; i >= 0; i -= 1) {
        const entry = networkBuf[i];
        if (entry === undefined) continue;
        if (entry.url === url && entry.status === null && !entry.failed) {
          entry.status = res.status();
          entry.statusText = res.statusText();
          entry.fromCache = res.fromServiceWorker();
          break;
        }
      }
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
  return items.map((item) => ({ ...item, pageStateId }));
}
