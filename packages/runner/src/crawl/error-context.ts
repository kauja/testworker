import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BrowserContext, Page } from 'playwright';
import type {
  ConsoleEntry,
  CrawlOptions,
  ErrorContext,
  ErrorInteraction,
  ErrorStackFrame,
  NetworkEntry,
  PageError,
} from '@testworker/shared';

const MAX_DOM_BYTES = 1024 * 1024;
const INTERACTION_LIMIT = 10;
const NETWORK_LIMIT = 5;
const CONSOLE_LIMIT = 30;

declare global {
  interface Window {
    __testworkerRootCauseEvents?: RecordedInteraction[];
  }
}

export interface RecordedInteraction {
  kind: ErrorInteraction['kind'];
  selector: string | null;
  domPath: string | null;
  text: string | null;
  value: string | null;
  key: string | null;
  timestamp: string;
  boundingBox: ErrorInteraction['boundingBox'];
}

const INTERACTION_RECORDER = `(() => {
  if (window.__testworkerRootCauseInstalled) return;
  window.__testworkerRootCauseInstalled = true;
  window.__testworkerRootCauseEvents = [];

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) return '#' + CSS.escape(el.id);
    const testId = el.getAttribute('data-testid');
    if (testId) return '[data-testid="' + testId.replace(/"/g, '\\\\"') + '"]';
    const name = el.getAttribute('name');
    if (name) return el.tagName.toLowerCase() + '[name="' + name.replace(/"/g, '\\\\"') + '"]';
    return domPath(el);
  }

  function domPath(el) {
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.parentElement) {
        const idx = Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1;
        part += ':nth-child(' + idx + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function boxFor(el) {
    if (!el || !el.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }

  function textFor(el) {
    return ((el && el.textContent) || '').trim().replace(/\\s+/g, ' ').slice(0, 120) || null;
  }

  function maskValue(el) {
    if (!el) return null;
    const type = String(el.getAttribute('type') || '').toLowerCase();
    const name = String(el.getAttribute('name') || el.getAttribute('id') || '').toLowerCase();
    const sensitive = /password|token|secret|credit|card|cc|cvv|pin/.test(type + ' ' + name);
    if (sensitive) return '[masked]';
    const value = typeof el.value === 'string' ? el.value : '';
    return value ? value.slice(0, 120) : null;
  }

  function push(event) {
    const events = window.__testworkerRootCauseEvents;
    events.push(event);
    if (events.length > 100) events.splice(0, events.length - 100);
  }

  document.addEventListener('click', (ev) => {
    const el = ev.target && ev.target.closest ? ev.target.closest('a,button,input,textarea,select,[role="button"],[role="link"]') : ev.target;
    push({ kind: 'click', selector: selectorFor(el), domPath: domPath(el), text: textFor(el), value: null, key: null, timestamp: new Date().toISOString(), boundingBox: boxFor(el) });
  }, true);

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    push({ kind: 'input', selector: selectorFor(el), domPath: domPath(el), text: textFor(el), value: maskValue(el), key: null, timestamp: new Date().toISOString(), boundingBox: boxFor(el) });
  }, true);

  document.addEventListener('keydown', (ev) => {
    push({ kind: 'keypress', selector: selectorFor(ev.target), domPath: domPath(ev.target), text: textFor(ev.target), value: null, key: ev.key.length === 1 ? '[key]' : ev.key, timestamp: new Date().toISOString(), boundingBox: boxFor(ev.target) });
  }, true);

  window.addEventListener('scroll', () => {
    push({ kind: 'scroll', selector: null, domPath: null, text: null, value: null, key: null, timestamp: new Date().toISOString(), boundingBox: null });
  }, true);

  const pushState = history.pushState;
  history.pushState = function() {
    const result = pushState.apply(this, arguments);
    push({ kind: 'history', selector: null, domPath: null, text: location.href, value: null, key: null, timestamp: new Date().toISOString(), boundingBox: null });
    return result;
  };
  const replaceState = history.replaceState;
  history.replaceState = function() {
    const result = replaceState.apply(this, arguments);
    push({ kind: 'history', selector: null, domPath: null, text: location.href, value: null, key: null, timestamp: new Date().toISOString(), boundingBox: null });
    return result;
  };
  window.addEventListener('popstate', () => {
    push({ kind: 'history', selector: null, domPath: null, text: location.href, value: null, key: null, timestamp: new Date().toISOString(), boundingBox: null });
  });
})()`;

export async function installRootCauseRecorder(context: BrowserContext): Promise<void> {
  await context.addInitScript(INTERACTION_RECORDER);
}

export async function collectErrorContexts(params: {
  page: Page;
  context: BrowserContext;
  dataDir: string;
  runId: string;
  pageStateId: string;
  errors: PageError[];
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  options: CrawlOptions;
}): Promise<ErrorContext[]> {
  if (params.errors.length === 0) return [];
  const interactions = await readInteractions(params.page);
  const env = await readEnvironment(params.page);
  const storage = params.options.collectStorage
    ? await readStorage(params.page, params.context)
    : null;

  const contexts: ErrorContext[] = [];
  for (const error of params.errors) {
    const relDir = join('runs', params.runId, 'errors', error.id);
    const absDir = join(params.dataDir, relDir);
    await mkdir(absDir, { recursive: true });

    const domSnapshotRef = await writeDomSnapshot(params.page, relDir, absDir).catch(() => null);
    const screenshotRef = await writeErrorScreenshot(params.page, relDir, absDir).catch(() => null);
    const errorAt = Date.parse(error.timestamp);
    contexts.push({
      ...buildErrorContext({
        error,
        pageStateId: params.pageStateId,
        interactions,
        networkEntries: params.networkEntries,
        consoleEntries: params.consoleEntries,
        env,
        storage,
        capturedAt: new Date().toISOString(),
      }),
      domSnapshotRef,
      screenshotRef,
    });
  }
  return contexts;
}

export function buildErrorContext(input: {
  error: PageError;
  pageStateId: string;
  interactions: RecordedInteraction[];
  networkEntries: NetworkEntry[];
  consoleEntries: ConsoleEntry[];
  env: ErrorContext['env'];
  storage: ErrorContext['storage'];
  capturedAt: string;
}): Omit<ErrorContext, 'domSnapshotRef' | 'screenshotRef'> {
  const errorAt = Date.parse(input.error.timestamp);
  return {
    errorId: input.error.id,
    pageStateId: input.pageStateId,
    capturedAt: input.capturedAt,
    message: input.error.message,
    stack: input.error.stack,
    symbolicatedStack: stackFrames(input.error.stack),
    recentInteractions: recentByTime(input.interactions, errorAt, INTERACTION_LIMIT),
    recentNetwork: recentNetwork(input.networkEntries, errorAt),
    recentConsole: recentConsole(input.consoleEntries, errorAt),
    env: input.env,
    storage: input.storage,
  };
}

function stackFrames(stack: string | null): ErrorStackFrame[] {
  if (!stack) return [];
  return stack
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((raw) => {
      const match = raw.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
      if (!match) return { raw, functionName: null, file: null, line: null, column: null };
      return {
        raw,
        functionName: match[1] ?? null,
        file: match[2] ?? null,
        line: Number(match[3]),
        column: Number(match[4]),
      };
    });
}

function recentByTime<T extends { timestamp: string }>(
  entries: T[],
  errorAt: number,
  limit: number,
): Array<T & { deltaMs: number }> {
  return entries
    .map((entry) => ({ ...entry, deltaMs: Date.parse(entry.timestamp) - errorAt }))
    .filter((entry) => Number.isFinite(entry.deltaMs) && entry.deltaMs <= 0)
    .sort((a, b) => b.deltaMs - a.deltaMs)
    .slice(0, limit);
}

function recentNetwork(entries: NetworkEntry[], errorAt: number): ErrorContext['recentNetwork'] {
  return entries
    .map((entry) => ({ ...entry, deltaMs: Date.parse(entry.startedAt) - errorAt }))
    .filter((entry) => Number.isFinite(entry.deltaMs) && entry.deltaMs <= 0)
    .sort((a, b) => {
      const failureBias =
        Number(b.failed || (b.status ?? 0) >= 400) - Number(a.failed || (a.status ?? 0) >= 400);
      return failureBias || b.deltaMs - a.deltaMs;
    })
    .slice(0, NETWORK_LIMIT);
}

function recentConsole(entries: ConsoleEntry[], errorAt: number): ErrorContext['recentConsole'] {
  return recentByTime(entries, errorAt, CONSOLE_LIMIT);
}

async function readInteractions(page: Page): Promise<RecordedInteraction[]> {
  const events = await page
    .evaluate(`window.__testworkerRootCauseEvents ?? []`)
    .catch(() => [] as unknown);
  return Array.isArray(events) ? (events as RecordedInteraction[]) : [];
}

async function readEnvironment(page: Page): Promise<ErrorContext['env']> {
  return page.evaluate(`(() => ({
    url: location.href,
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    userAgent: navigator.userAgent,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }))()`);
}

async function readStorage(
  page: Page,
  context: BrowserContext,
): Promise<NonNullable<ErrorContext['storage']>> {
  const [webStorageRaw, cookies] = await Promise.all([
    page.evaluate(`(() => {
      const local = {};
      const session = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key) local[key] = localStorage.getItem(key) ?? '';
      }
      for (let i = 0; i < sessionStorage.length; i += 1) {
        const key = sessionStorage.key(i);
        if (key) session[key] = sessionStorage.getItem(key) ?? '';
      }
      return { localStorage: local, sessionStorage: session };
    })()`),
    context.cookies(page.url()),
  ]);
  const webStorage = webStorageRaw as {
    localStorage: Record<string, string>;
    sessionStorage: Record<string, string>;
  };
  return {
    ...webStorage,
    cookies: cookies.map((cookie) => ({
      name: cookie.name,
      domain: cookie.domain,
      path: cookie.path,
      expires: cookie.expires,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      sameSite: cookie.sameSite,
    })),
  };
}

async function writeDomSnapshot(page: Page, relDir: string, absDir: string): Promise<string> {
  let html = (await page.evaluate(`document.documentElement.outerHTML`)) as string;
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > MAX_DOM_BYTES) {
    const hash = createHash('sha256').update(html).digest('hex');
    html = `${html.slice(0, MAX_DOM_BYTES)}\n<!-- truncated bytes=${bytes} sha256=${hash} -->`;
  }
  const relPath = join(relDir, 'dom.html');
  await writeFile(join(absDir, 'dom.html'), html);
  return relPath;
}

async function writeErrorScreenshot(page: Page, relDir: string, absDir: string): Promise<string> {
  const relPath = join(relDir, 'screenshot.png');
  await page.screenshot({ path: join(absDir, 'screenshot.png'), fullPage: false });
  return relPath;
}
