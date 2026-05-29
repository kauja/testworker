import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { log } from '@testworker/shared';
import { getRunErrors, getStateGraph, pickValidOptionFields, rowToRun } from './queries.js';

const baseRow = (options: unknown, overrides: Partial<Parameters<typeof rowToRun>[0]> = {}) => ({
  id: 'run_1',
  start_url: 'https://example.com/start',
  status: 'completed',
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: null,
  options_json: typeof options === 'string' ? options : JSON.stringify(options),
  error_message: null,
  pages_done: 0,
  queue_size: null,
  current_url: null,
  har_path: null,
  ...overrides,
});

describe('rowToRun', () => {
  it('merges legacy options with row start_url and zod defaults', () => {
    const run = rowToRun(
      baseRow({
        maxDepth: 2,
        maxPages: 12,
        sameOriginOnly: false,
        viewport: { width: 390, height: 844 },
        includeUrlPatterns: ['/docs'],
      }),
    );

    expect(run.options).toMatchObject({
      startUrl: 'https://example.com/start',
      maxDepth: 2,
      maxPages: 12,
      sameOriginOnly: false,
      navTimeoutMs: 15_000,
      viewport: { width: 390, height: 844 },
      includeUrlPatterns: ['/docs'],
    });
  });

  it('falls back to defaults when options_json is malformed', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    const run = rowToRun(baseRow('{bad json'));

    expect(run.options).toMatchObject({
      startUrl: 'https://example.com/start',
      maxDepth: 3,
      maxPages: 50,
      sameOriginOnly: true,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run_1', err: expect.any(String) }),
      'options_json JSON.parse failed',
    );
    warn.mockRestore();
  });

  it('keeps valid fields when one option field is invalid', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    const run = rowToRun(
      baseRow({
        startUrl: 'https://example.com/from-json',
        maxDepth: 'bad',
        maxPages: 7,
        viewport: { width: 1024, height: 768 },
      }),
    );

    expect(run.options).toMatchObject({
      startUrl: 'https://example.com/from-json',
      maxDepth: 3,
      maxPages: 7,
      viewport: { width: 1024, height: 768 },
    });
    warn.mockRestore();
  });

  it('preserves non-url legacy start_url in the final fallback', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);

    const run = rowToRun(baseRow({ maxPages: 9 }, { start_url: 'localhost:3000' }));

    expect(run.options).toMatchObject({
      startUrl: 'localhost:3000',
      maxDepth: 3,
      maxPages: 9,
      sameOriginOnly: true,
    });
    warn.mockRestore();
  });
});

describe('pickValidOptionFields', () => {
  it('drops invalid fields without discarding valid siblings', () => {
    expect(
      pickValidOptionFields({
        startUrl: 'https://example.com',
        maxDepth: 4,
        maxPages: 0,
        sameOriginOnly: false,
        viewport: { width: -1, height: 800 },
        includeUrlPatterns: ['/ok'],
        unknown: 'ignored',
      }),
    ).toEqual({
      startUrl: 'https://example.com',
      maxDepth: 4,
      sameOriginOnly: false,
      includeUrlPatterns: ['/ok'],
    });
  });
});

describe('getRunErrors', () => {
  it('returns page, console, and network errors with matching totals', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE runs (id TEXT PRIMARY KEY);
      CREATE TABLE page_states (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL
      );
      CREATE TABLE page_errors (
        id TEXT PRIMARY KEY,
        page_state_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        stack TEXT,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE console_entries (
        id TEXT PRIMARY KEY,
        page_state_id TEXT NOT NULL,
        level TEXT NOT NULL,
        text TEXT NOT NULL,
        url TEXT,
        line_number INTEGER,
        timestamp TEXT NOT NULL
      );
      CREATE TABLE network_entries (
        id TEXT PRIMARY KEY,
        page_state_id TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        status INTEGER,
        status_text TEXT,
        resource_type TEXT NOT NULL,
        started_at TEXT NOT NULL,
        duration_ms INTEGER,
        from_cache INTEGER NOT NULL,
        failed INTEGER NOT NULL,
        failure_text TEXT
      );
    `);
    db.prepare(`INSERT INTO runs (id) VALUES (?)`).run('run_1');
    db.prepare(`INSERT INTO page_states (id, run_id, url, title) VALUES (?, ?, ?, ?)`).run(
      'page_1',
      'run_1',
      'https://example.com',
      'Home',
    );
    db.prepare(`INSERT INTO page_errors VALUES (?, ?, ?, ?, ?, ?)`).run(
      'err_1',
      'page_1',
      'pageerror',
      'boom',
      null,
      '2026-01-01T00:00:00.000Z',
    );
    db.prepare(`INSERT INTO console_entries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'console_1',
      'page_1',
      'error',
      'console boom',
      'https://example.com/app.js',
      10,
      '2026-01-01T00:00:01.000Z',
    );
    db.prepare(`INSERT INTO console_entries VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      'console_2',
      'page_1',
      'warn',
      'not counted',
      null,
      null,
      '2026-01-01T00:00:02.000Z',
    );
    db.prepare(`INSERT INTO network_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'net_1',
      'page_1',
      'GET',
      'https://example.com/missing.png',
      404,
      'Not Found',
      'image',
      '2026-01-01T00:00:03.000Z',
      12,
      0,
      0,
      null,
    );
    db.prepare(`INSERT INTO network_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'net_2',
      'page_1',
      'GET',
      'https://example.com/ok.png',
      200,
      'OK',
      'image',
      '2026-01-01T00:00:04.000Z',
      8,
      0,
      0,
      null,
    );

    const payload = getRunErrors(db, 'run_1');

    expect(payload?.totals).toEqual({
      pageErrors: 1,
      consoleErrors: 1,
      networkErrors: 1,
      all: 3,
    });
    expect(payload?.pageErrorGroups).toHaveLength(1);
    expect(payload?.consoleErrors[0]).toMatchObject({
      text: 'console boom',
      page: { pageStateId: 'page_1', title: 'Home' },
    });
    expect(payload?.networkErrors[0]).toMatchObject({
      status: 404,
      page: { pageStateId: 'page_1', title: 'Home' },
    });
    db.close();
  });
});

describe('getStateGraph', () => {
  it('returns v2 screens and states when the split schema is present', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE runs (
        id TEXT PRIMARY KEY,
        start_url TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        options_json TEXT NOT NULL,
        error_message TEXT,
        pages_done INTEGER NOT NULL DEFAULT 0,
        queue_size INTEGER,
        current_url TEXT,
        har_path TEXT
      );
      CREATE TABLE page_states (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        signature TEXT NOT NULL,
        depth INTEGER NOT NULL,
        visited_at TEXT NOT NULL,
        screenshot_path TEXT,
        viewport_w INTEGER NOT NULL,
        viewport_h INTEGER NOT NULL,
        error_count INTEGER NOT NULL DEFAULT 0,
        console_error_count INTEGER NOT NULL DEFAULT 0,
        network_error_count INTEGER NOT NULL DEFAULT 0,
        metrics_json TEXT
      );
      CREATE TABLE screens (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        url TEXT NOT NULL,
        pathname TEXT NOT NULL,
        title TEXT NOT NULL,
        nav_hash TEXT NOT NULL
      );
      CREATE TABLE screen_states (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        screen_id TEXT NOT NULL,
        structure_hash TEXT NOT NULL,
        arrival_trigger TEXT,
        arrival_selector TEXT
      );
      CREATE TABLE edges (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        from_page_state_id TEXT NOT NULL,
        to_page_state_id TEXT NOT NULL,
        kind TEXT,
        from_state_id TEXT,
        to_state_id TEXT,
        trigger TEXT NOT NULL,
        trigger_selector TEXT,
        trigger_text TEXT,
        created_at TEXT NOT NULL
      );
    `);
    db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'run_1',
      'https://example.com',
      'completed',
      '2026-01-01T00:00:00.000Z',
      null,
      JSON.stringify({ startUrl: 'https://example.com' }),
      null,
      1,
      0,
      null,
      null,
    );
    db.prepare(`INSERT INTO screens VALUES (?, ?, ?, ?, ?, ?)`).run(
      'sc_1',
      'run_1',
      'https://example.com',
      '/',
      'Home',
      'nav_a',
    );
    db.prepare(`INSERT INTO screen_states VALUES (?, ?, ?, ?, ?, ?)`).run(
      'st_1',
      'run_1',
      'sc_1',
      'struct_a',
      'initial',
      null,
    );

    const graph = getStateGraph(db, 'run_1');

    expect(graph?.screens).toEqual([
      {
        id: 'sc_1',
        runId: 'run_1',
        url: 'https://example.com',
        pathname: '/',
        title: 'Home',
        navHash: 'nav_a',
      },
    ]);
    expect(graph?.states).toEqual([
      {
        id: 'st_1',
        runId: 'run_1',
        screenId: 'sc_1',
        structureHash: 'struct_a',
        arrivalTrigger: 'initial',
        arrivalSelector: null,
      },
    ]);
    db.close();
  });
});
