import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './client.js';
import { insertEdge, insertRun, updateRunStatus, upsertPageState } from './repo.js';

let db: Db;

beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      start_url TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      options_json TEXT NOT NULL,
      error_message TEXT
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
      network_error_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX uniq_page_states_run_signature ON page_states(run_id, signature);

    CREATE TABLE edges (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
      from_page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
      to_page_state_id TEXT NOT NULL REFERENCES page_states(id) ON DELETE CASCADE,
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
  startUrl: 'https://example.com',
  status: 'running' as const,
  startedAt: '2026-01-01T00:00:00.000Z',
  finishedAt: null,
  options: {
    startUrl: 'https://example.com',
    maxDepth: 3,
    maxPages: 50,
    sameOriginOnly: true,
    navTimeoutMs: 15_000,
    waitAfterNavMs: 500,
    viewport: { width: 1280, height: 800 },
    includeUrlPatterns: [],
    excludeUrlPatterns: [],
  },
  errorMessage: null,
};

describe('run repository writes', () => {
  it('serializes run options on insert', () => {
    insertRun(db, run);

    const row = db.$sqlite.prepare('SELECT * FROM runs WHERE id = ?').get('run_1') as {
      options_json: string;
      start_url: string;
    };

    expect(row.start_url).toBe('https://example.com');
    expect(JSON.parse(row.options_json)).toMatchObject({ maxDepth: 3, maxPages: 50 });
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
      });
    }

    insertEdge(db, {
      id: 'edge_a',
      runId: 'run_1',
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
      fromPageStateId: 'from',
      toPageStateId: 'to',
      trigger: 'link',
      triggerSelector: 'a.next',
      triggerText: 'Next again',
      createdAt: '2026-01-01T00:00:03.000Z',
    });

    expect(db.$sqlite.prepare('SELECT id FROM edges').all()).toEqual([{ id: 'edge_a' }]);
  });
});
