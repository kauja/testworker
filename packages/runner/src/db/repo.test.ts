import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import {
  findScreenStateByIdentity,
  insertEdge,
  insertRun,
  updateRunStatus,
  upsertPageState,
  upsertScreen,
  upsertScreenState,
} from './repo.js';

let db: Db;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      origin_spec TEXT NOT NULL UNIQUE,
      entry_url TEXT NOT NULL,
      defaults_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      app_id TEXT,
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
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
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
    CREATE UNIQUE INDEX uniq_page_states_run_signature ON page_states(run_id, signature);

    CREATE TABLE screens (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      pathname TEXT NOT NULL,
      title TEXT NOT NULL,
      nav_hash TEXT NOT NULL
    );
    CREATE UNIQUE INDEX uniq_screens_run_nav_hash ON screens(run_id, nav_hash);

    CREATE TABLE screen_states (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      screen_id TEXT NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
      structure_hash TEXT NOT NULL,
      arrival_trigger TEXT,
      arrival_selector TEXT
    );
    CREATE UNIQUE INDEX uniq_screen_states_run_screen_structure
      ON screen_states(run_id, screen_id, structure_hash);

    CREATE TABLE edges (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      from_page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
      to_page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      from_state_id TEXT NOT NULL,
      to_state_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      trigger_selector TEXT,
      trigger_text TEXT,
      created_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX uniq_edges_pair_trigger
      ON edges(run_id, from_page_state_id, to_page_state_id, trigger, COALESCE(trigger_selector, ''));
  `);
  db = { $sqlite: sqlite, close: () => sqlite.close() };
});

afterEach(() => {
  db.close();
});

const run = {
  id: 'run_1',
  appId: null,
  startUrl: 'https://example.com',
  status: 'running' as const,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  options: {
    startUrl: 'https://example.com',
    maxDepth: 3,
    maxPages: 50,
    sameOriginOnly: true,
    respectRobots: true,
    navTimeoutMs: 15_000,
    waitAfterNavMs: 500,
    waitStrategy: 'load' as const,
    viewport: { width: 1280, height: 800 },
    includeUrlPatterns: [],
    excludeUrlPatterns: [],
    captureWebVitals: true,
    autoScroll: false,
    autoScrollMaxSteps: 10,
    autoScrollDelayMs: 400,
    blockResourceTypes: [],
    blockUrlPatterns: [],
    cacheMode: 'warm' as const,
    networkThrottle: 'none' as const,
    cpuThrottle: 1,
    deviceProfile: 'desktop' as const,
  },
  errorMessage: null,
  pagesDone: 0,
  queueSize: 1,
  currentUrl: 'https://example.com',
  harPath: null,
};

describe('run repository writes', () => {
  it('serializes run options on insert', () => {
    insertRun(db, run);

    const row = db.$sqlite.prepare('SELECT * FROM runs WHERE id = ?').get('run_1') as {
      app_id: string;
      options_json: string;
      start_url: string;
    };

    expect(row.app_id).toBe('app_327c3fda87ce');
    expect(row.start_url).toBe('https://example.com');
    expect(JSON.parse(row.options_json)).toMatchObject({ maxDepth: 3, maxPages: 50 });
    expect(
      JSON.parse(
        (db.$sqlite.prepare('SELECT origin_spec FROM apps').get() as { origin_spec: string })
          .origin_spec,
      ),
    ).toEqual({
      scheme: 'https',
      host: { mode: 'exact', value: 'example.com' },
      port: 'same',
      allowList: [],
      blockList: [],
    });
  });

  it('updates terminal run status fields', () => {
    insertRun(db, run);

    updateRunStatus(db, 'run_1', 'failed', '2026-01-01T00:01:00.000Z', 'boom');

    expect(db.$sqlite.prepare('SELECT status, finished_at, error_message FROM runs').get()).toEqual(
      {
        status: 'failed',
        finished_at: '2026-01-01T00:01:00.000Z',
        error_message: 'boom',
      },
    );
  });
});

describe('graph repository writes', () => {
  it('upserts page states by run and signature while accumulating counters', () => {
    insertRun(db, run);

    upsertPageState(db, {
      id: 'page_a',
      runId: 'run_1',
      url: 'https://example.com/a',
      title: 'A',
      signature: '/a#abc',
      depth: 1,
      visitedAt: '2026-01-01T00:00:01.000Z',
      screenshotPath: null,
      viewport: { width: 1280, height: 800 },
      errorCount: 1,
      consoleErrorCount: 2,
      networkErrorCount: 3,
      metrics: { lcp: 2100, cls: 0.02 },
    });
    upsertPageState(db, {
      id: 'page_b',
      runId: 'run_1',
      url: 'https://example.com/a',
      title: 'A updated',
      signature: '/a#abc',
      depth: 1,
      visitedAt: '2026-01-01T00:00:02.000Z',
      screenshotPath: 'shots/a.png',
      viewport: { width: 1280, height: 800 },
      errorCount: 4,
      consoleErrorCount: 5,
      networkErrorCount: 6,
      metrics: { lcp: 3200, cls: 0.18, fcp: 900 },
    });

    expect(db.$sqlite.prepare('SELECT COUNT(*) AS count FROM page_states').get()).toEqual({
      count: 1,
    });
    expect(
      db.$sqlite
        .prepare(
          'SELECT id, title, screenshot_path, error_count, console_error_count, network_error_count FROM page_states',
        )
        .get(),
    ).toEqual({
      id: 'page_a',
      title: 'A updated',
      screenshot_path: 'shots/a.png',
      error_count: 5,
      console_error_count: 7,
      network_error_count: 9,
    });
    const metrics = db.$sqlite.prepare('SELECT metrics_json FROM page_states').get() as {
      metrics_json: string;
    };
    expect(JSON.parse(metrics.metrics_json)).toEqual({ lcp: 3200, cls: 0.18, fcp: 900 });
  });

  it('ignores duplicate edges with the same run/from/to/trigger/selector', () => {
    insertRun(db, run);
    for (const page of ['from', 'to']) {
      upsertPageState(db, {
        id: page,
        runId: 'run_1',
        url: `https://example.com/${page}`,
        title: page,
        signature: `/${page}#abc`,
        depth: 1,
        visitedAt: '2026-01-01T00:00:01.000Z',
        screenshotPath: null,
        viewport: { width: 1280, height: 800 },
        errorCount: 0,
        consoleErrorCount: 0,
        networkErrorCount: 0,
        metrics: {},
      });
    }

    insertEdge(db, {
      id: 'edge_a',
      runId: 'run_1',
      fromStateId: 'from',
      toStateId: 'to',
      kind: 'nav',
      fromPageStateId: 'from',
      toPageStateId: 'to',
      trigger: 'link',
      triggerSelector: 'a.next',
      triggerText: 'Next',
      createdAt: '2026-01-01T00:00:02.000Z',
    });
    insertEdge(db, {
      id: 'edge_b',
      runId: 'run_1',
      fromStateId: 'from',
      toStateId: 'to',
      kind: 'nav',
      fromPageStateId: 'from',
      toPageStateId: 'to',
      trigger: 'link',
      triggerSelector: 'a.next',
      triggerText: 'Next again',
      createdAt: '2026-01-01T00:00:03.000Z',
    });

    expect(db.$sqlite.prepare('SELECT id FROM edges').all()).toEqual([{ id: 'edge_a' }]);
  });

  it('deduplicates screen states by screen and structure hash', () => {
    insertRun(db, run);
    upsertScreen(db, {
      id: 'sc_main',
      runId: 'run_1',
      url: 'https://example.com/docs',
      pathname: '/docs',
      title: 'Docs',
      navHash: 'nav_a',
    });
    upsertScreenState(db, {
      id: 'st_a',
      runId: 'run_1',
      screenId: 'sc_main',
      structureHash: 'struct_a',
      arrivalTrigger: 'initial',
      arrivalSelector: null,
    });
    upsertScreenState(db, {
      id: 'st_b',
      runId: 'run_1',
      screenId: 'sc_main',
      structureHash: 'struct_a',
      arrivalTrigger: 'click',
      arrivalSelector: 'a.next',
    });

    expect(db.$sqlite.prepare('SELECT COUNT(*) AS count FROM screen_states').get()).toEqual({
      count: 1,
    });
    expect(findScreenStateByIdentity(db, 'run_1', 'nav_a', 'struct_a')).toEqual({
      id: 'st_a',
      screenId: 'sc_main',
    });
  });
});
