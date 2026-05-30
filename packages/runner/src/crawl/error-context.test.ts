import { describe, expect, it } from 'vitest';
import type { ConsoleEntry, NetworkEntry, PageError } from '@testworker/shared';
import { buildErrorContext, type RecordedInteraction } from './error-context.js';

const env = {
  url: 'https://example.com/dashboard',
  pathname: '/dashboard',
  search: '',
  hash: '',
  viewport: { width: 1280, height: 800 },
  devicePixelRatio: 2,
  userAgent: 'vitest',
  language: 'ja',
  timezone: 'Asia/Tokyo',
};

const error: PageError = {
  id: 'err_1',
  pageStateId: 'page_1',
  kind: 'pageerror',
  message: 'Cannot read properties of undefined',
  stack:
    'TypeError: Cannot read properties of undefined\n    at Home (https://example.com/app.js:10:5)',
  timestamp: '2026-01-01T00:00:10.000Z',
};

describe('buildErrorContext', () => {
  it('keeps only interactions that happened before the error', () => {
    const interactions: RecordedInteraction[] = [
      interaction('click', '2026-01-01T00:00:09.900Z', '#save'),
      interaction('input', '2026-01-01T00:00:10.100Z', '#late'),
    ];

    const context = buildErrorContext({
      error,
      pageStateId: 'page_1',
      interactions,
      networkEntries: [],
      consoleEntries: [],
      env,
      storage: null,
      capturedAt: '2026-01-01T00:00:11.000Z',
    });

    expect(context.recentInteractions).toHaveLength(1);
    expect(context.recentInteractions[0]).toMatchObject({ selector: '#save', deltaMs: -100 });
  });

  it('prioritizes failed network entries in the recent network bundle', () => {
    const networkEntries: NetworkEntry[] = [
      network('net_ok', 'https://example.com/ok', 200, false, '2026-01-01T00:00:09.900Z'),
      network('net_bad', 'https://example.com/fail', 500, false, '2026-01-01T00:00:09.000Z'),
    ];

    const context = buildErrorContext({
      error,
      pageStateId: 'page_1',
      interactions: [],
      networkEntries,
      consoleEntries: [],
      env,
      storage: null,
      capturedAt: '2026-01-01T00:00:11.000Z',
    });

    expect(context.recentNetwork.map((entry) => entry.id)).toEqual(['net_bad', 'net_ok']);
  });

  it('parses stack frames and keeps recent console messages', () => {
    const consoleEntries: ConsoleEntry[] = [
      consoleEntry('c1', 'warn', 'before', '2026-01-01T00:00:09.500Z'),
      consoleEntry('c2', 'error', 'after', '2026-01-01T00:00:10.500Z'),
    ];

    const context = buildErrorContext({
      error,
      pageStateId: 'page_1',
      interactions: [],
      networkEntries: [],
      consoleEntries,
      env,
      storage: null,
      capturedAt: '2026-01-01T00:00:11.000Z',
    });

    expect(context.symbolicatedStack[1]).toMatchObject({
      functionName: 'Home',
      file: 'https://example.com/app.js',
      line: 10,
      column: 5,
    });
    expect(context.recentConsole.map((entry) => entry.id)).toEqual(['c1']);
  });
});

function interaction(
  kind: RecordedInteraction['kind'],
  timestamp: string,
  selector: string,
): RecordedInteraction {
  return {
    kind,
    selector,
    domPath: selector,
    text: null,
    value: null,
    key: null,
    timestamp,
    boundingBox: null,
  };
}

function network(
  id: string,
  url: string,
  status: number,
  failed: boolean,
  startedAt: string,
): NetworkEntry {
  return {
    id,
    pageStateId: 'page_1',
    method: 'GET',
    url,
    status,
    statusText: String(status),
    resourceType: 'fetch',
    startedAt,
    durationMs: 10,
    fromCache: false,
    failed,
    failureText: null,
  };
}

function consoleEntry(
  id: string,
  level: ConsoleEntry['level'],
  text: string,
  timestamp: string,
): ConsoleEntry {
  return {
    id,
    pageStateId: 'page_1',
    level,
    text,
    url: null,
    lineNumber: null,
    timestamp,
  };
}
