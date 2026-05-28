import type { BrowserContext, Page, Request, Response } from 'playwright';
import {
  newEventId,
  type ConsoleEntry,
  type NetworkEntry,
  type PageError,
} from '@testworker/shared';
import { BLOCKED_BY_CLIENT_ERROR } from './resource-block.js';

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
      // Issue #202: context.route で意図的に abort したリソース (analytics / ads / font 等) は
      // ネットワークエラーではないので network buffer に積まない (networkErrorCount を汚さない)。
      if (req.failure()?.errorText === BLOCKED_BY_CLIENT_ERROR) return;
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

    page.on('requestfinished', async (req) => {
      const started = requestStart.get(req);
      // await 前に push 先 buffer の参照を固定する。 await 中に rotate() が走ると
      // networkBuf は新ページ用の空配列に差し替わるため、 await 完了後の push が
      // 旧ページの request を新ページの snapshot に誤帰属させる race を生む。
      // 固定参照と現在の buffer を比べ、 一致しない (= rotate された) なら drop。
      const targetBuf = networkBuf;
      let res: Response | null = null;
      try {
        res = await req.response();
      } catch {
        res = null;
      }
      if (targetBuf !== networkBuf) return;
      targetBuf.push({
        id: newEventId(),
        pageStateId: PLACEHOLDER,
        method: req.method(),
        url: req.url(),
        status: res?.status() ?? null,
        statusText: res?.statusText() ?? null,
        resourceType: req.resourceType(),
        startedAt: new Date(started ?? Date.now()).toISOString(),
        durationMs: started ? Date.now() - started : null,
        fromCache: Boolean(res && res.fromServiceWorker()) || false,
        failed: false,
        failureText: null,
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
  return items.map((item) => ({ ...item, pageStateId }));
}
