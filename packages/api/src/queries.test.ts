import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { log } from '@testworker/shared';
import {
  getGraph,
  getRunDiff,
  getRunErrors,
  getRunStateGraphDiff,
  getScreenStability,
  getStateGraph,
  listApps,
  pickValidOptionFields,
  rowToRun,
  scoreScreenStability,
} from './queries.js';

const baseRow = (options: unknown, overrides: Partial<Parameters<typeof rowToRun>[0]> = {}) => ({
  id: 'run_1',
  app_id: null,
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

function createStabilityDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
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
    CREATE TABLE screen_stability (
      origin TEXT NOT NULL,
      screen_nav_hash TEXT NOT NULL,
      score REAL NOT NULL,
      sample_count INTEGER NOT NULL,
      distinct_hash_count INTEGER NOT NULL,
      threshold REAL NOT NULL,
      flaky INTEGER NOT NULL DEFAULT 0,
      computed_at TEXT NOT NULL,
      PRIMARY KEY (origin, screen_nav_hash)
    );
  `);
  return db;
}

function insertRunWithScreen(
  db: Database.Database,
  runId: string,
  startedAt: string,
  structureHash: string,
  signature = structureHash,
): void {
  db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    runId,
    null,
    'https://example.com',
    'completed',
    startedAt,
    null,
    JSON.stringify({ startUrl: 'https://example.com' }),
    null,
    1,
    0,
    null,
    null,
  );
  db.prepare(`INSERT INTO page_states VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `st_${runId}`,
    runId,
    'https://example.com/dashboard',
    'Dashboard',
    signature,
    0,
    startedAt,
    null,
    1280,
    800,
    0,
    0,
    0,
    '{}',
  );
  db.prepare(`INSERT INTO screens VALUES (?, ?, ?, ?, ?, ?)`).run(
    `sc_${runId}`,
    runId,
    'https://example.com/dashboard',
    '/dashboard',
    'Dashboard',
    'nav_a',
  );
  db.prepare(`INSERT INTO screen_states VALUES (?, ?, ?, ?, ?, ?)`).run(
    `st_${runId}`,
    runId,
    `sc_${runId}`,
    structureHash,
    'initial',
    null,
  );
}

function insertScreenState(
  db: Database.Database,
  runId: string,
  screenId: string,
  stateId: string,
  structureHash: string,
): void {
  db.prepare(`INSERT INTO screen_states VALUES (?, ?, ?, ?, ?, ?)`).run(
    stateId,
    runId,
    screenId,
    structureHash,
    'initial',
    null,
  );
}

function insertStateEdge(
  db: Database.Database,
  runId: string,
  fromStateId: string,
  toStateId: string,
  trigger: string,
): void {
  db.prepare(`INSERT INTO edges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    `edge_${runId}_${fromStateId}_${toStateId}_${trigger}`,
    runId,
    fromStateId,
    toStateId,
    'state',
    fromStateId,
    toStateId,
    trigger,
    null,
    null,
    '2026-01-01T00:00:00.000Z',
  );
}

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

describe('listApps', () => {
  it('groups runs under their app and exposes latest summary', () => {
    const db = new Database(':memory:');
    db.exec(`
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
      CREATE TABLE edges (id TEXT PRIMARY KEY, run_id TEXT NOT NULL);
    `);
    db.prepare(`INSERT INTO apps VALUES (?, ?, ?, ?, ?, ?)`).run(
      'app_1',
      'example.com',
      'https://example.com',
      'https://example.com/start',
      '{}',
      '2026-01-01T00:00:00.000Z',
    );
    for (const [runId, startedAt] of [
      ['run_old', '2026-01-01T00:00:00.000Z'],
      ['run_new', '2026-01-02T00:00:00.000Z'],
    ] as const) {
      db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        runId,
        'app_1',
        'https://example.com/start',
        'completed',
        startedAt,
        null,
        JSON.stringify({ startUrl: 'https://example.com/start' }),
        null,
        1,
        0,
        null,
        null,
      );
    }
    db.prepare(`INSERT INTO page_states VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'page_1',
      'run_new',
      'https://example.com/start',
      'Home',
      'sig',
      0,
      '2026-01-02T00:00:00.000Z',
      null,
      1280,
      800,
      1,
      2,
      3,
      '{}',
    );

    const apps = listApps(db);

    expect(apps).toHaveLength(1);
    expect(apps[0]!.runCount).toBe(2);
    expect(apps[0]!.latestRun?.run.id).toBe('run_new');
    expect(apps[0]!.totalErrorCount).toBe(6);
    db.close();
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
    db.prepare(`INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'run_1',
      null,
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

describe('scoreScreenStability', () => {
  it('scores complete matches as stable', () => {
    expect(scoreScreenStability(['a', 'a', 'a', 'a', 'a'])).toMatchObject({
      score: 1,
      sampleCount: 5,
      distinctHashCount: 1,
      flaky: false,
    });
  });

  it('marks fully changing samples as flaky', () => {
    expect(scoreScreenStability(['a', 'b', 'c', 'd', 'e'])).toMatchObject({
      score: 0,
      sampleCount: 5,
      distinctHashCount: 5,
      flaky: true,
    });
  });

  it('keeps intermediate samples above the default threshold visible', () => {
    expect(scoreScreenStability(['a', 'a', 'b', 'a', 'a'])).toMatchObject({
      score: 0.75,
      sampleCount: 5,
      distinctHashCount: 2,
      flaky: false,
    });
  });

  it('does not mark sample-short screens as flaky', () => {
    expect(scoreScreenStability(['a'], { sampleCount: 1 })).toMatchObject({
      score: 1,
      sampleCount: 1,
      distinctHashCount: 1,
      flaky: false,
    });
  });
});

describe('screen stability integration', () => {
  it('computes stability from recent same-origin runs and stores the result', () => {
    const db = createStabilityDb();
    insertRunWithScreen(db, 'run_1', '2026-01-01T00:00:00.000Z', 'struct_a');
    insertRunWithScreen(db, 'run_2', '2026-01-02T00:00:00.000Z', 'struct_b');
    insertRunWithScreen(db, 'run_3', '2026-01-03T00:00:00.000Z', 'struct_c');

    const stability = getScreenStability(db, 'nav_a', { windowSize: 3 });

    expect(stability).toMatchObject({
      navHash: 'nav_a',
      origin: 'https://example.com',
      score: 0,
      sampleCount: 3,
      distinctHashCount: 3,
      flaky: true,
    });
    expect(db.prepare(`SELECT flaky, sample_count FROM screen_stability`).get()).toEqual({
      flaky: 1,
      sample_count: 3,
    });
    db.close();
  });

  it('enriches graph pages with flaky metadata', () => {
    const db = createStabilityDb();
    insertRunWithScreen(db, 'run_1', '2026-01-01T00:00:00.000Z', 'struct_a');
    insertRunWithScreen(db, 'run_2', '2026-01-02T00:00:00.000Z', 'struct_b');

    const graph = getGraph(db, 'run_2');

    expect(graph?.pages[0]).toMatchObject({
      navHash: 'nav_a',
      structureHash: 'struct_b',
      flaky: true,
      stabilityScore: 0,
    });
    db.close();
  });

  it('hides flaky pages from run diff by default and restores them when requested', () => {
    const db = createStabilityDb();
    insertRunWithScreen(db, 'run_1', '2026-01-01T00:00:00.000Z', 'struct_a', 'sig_a');
    insertRunWithScreen(db, 'run_2', '2026-01-02T00:00:00.000Z', 'struct_b', 'sig_b');

    const hidden = getRunDiff(db, 'run_1', 'run_2');
    const shown = getRunDiff(db, 'run_1', 'run_2', { showFlaky: true });

    expect(hidden?.newPages).toHaveLength(0);
    expect(hidden?.removedPages).toHaveLength(0);
    expect(hidden?.summary.flakyHiddenCount).toBe(2);
    expect(shown?.newPages).toHaveLength(1);
    expect(shown?.removedPages).toHaveLength(1);
    expect(shown?.newPages[0]).toMatchObject({ flaky: true, stabilityScore: 0 });
    db.close();
  });
});

describe('getRunStateGraphDiff', () => {
  it('reports added states and edges', () => {
    const db = createStabilityDb();
    insertRunWithScreen(db, 'run_1', '2026-01-01T00:00:00.000Z', 'struct_a', 'sig_a');
    insertRunWithScreen(db, 'run_2', '2026-01-02T00:00:00.000Z', 'struct_a', 'sig_a');
    insertScreenState(db, 'run_2', 'sc_run_2', 'st_run_2_b', 'struct_b');
    insertStateEdge(db, 'run_2', 'st_run_2', 'st_run_2_b', 'click');

    const diff = getRunStateGraphDiff(db, 'run_1', 'run_2', { showFlaky: true });

    expect(diff?.screens).toHaveLength(1);
    expect(diff?.screens[0]).toMatchObject({
      navHash: 'nav_a',
      addedStates: [{ structureHash: 'struct_b' }],
      addedEdges: [{ fromStructureHash: 'struct_a', toStructureHash: 'struct_b' }],
      removedStates: [],
    });
    expect(diff?.summary).toMatchObject({ addedStateCount: 1, addedEdgeCount: 1 });
    db.close();
  });

  it('reports removed states and edges', () => {
    const db = createStabilityDb();
    insertRunWithScreen(db, 'run_1', '2026-01-01T00:00:00.000Z', 'struct_a', 'sig_a');
    insertScreenState(db, 'run_1', 'sc_run_1', 'st_run_1_b', 'struct_b');
    insertStateEdge(db, 'run_1', 'st_run_1', 'st_run_1_b', 'click');
    insertRunWithScreen(db, 'run_2', '2026-01-02T00:00:00.000Z', 'struct_a', 'sig_a');

    const diff = getRunStateGraphDiff(db, 'run_1', 'run_2', { showFlaky: true });

    expect(diff?.screens).toHaveLength(1);
    expect(diff?.screens[0]).toMatchObject({
      removedStates: [{ structureHash: 'struct_b' }],
      removedEdges: [{ fromStructureHash: 'struct_a', toStructureHash: 'struct_b' }],
      addedStates: [],
    });
    expect(diff?.summary).toMatchObject({ removedStateCount: 1, removedEdgeCount: 1 });
    db.close();
  });

  it('reports trigger changes on the same state edge', () => {
    const db = createStabilityDb();
    insertRunWithScreen(db, 'run_1', '2026-01-01T00:00:00.000Z', 'struct_a', 'sig_a');
    insertScreenState(db, 'run_1', 'sc_run_1', 'st_run_1_b', 'struct_b');
    insertStateEdge(db, 'run_1', 'st_run_1', 'st_run_1_b', 'link');
    insertRunWithScreen(db, 'run_2', '2026-01-02T00:00:00.000Z', 'struct_a', 'sig_a');
    insertScreenState(db, 'run_2', 'sc_run_2', 'st_run_2_b', 'struct_b');
    insertStateEdge(db, 'run_2', 'st_run_2', 'st_run_2_b', 'click');

    const diff = getRunStateGraphDiff(db, 'run_1', 'run_2', { showFlaky: true });

    expect(diff?.screens).toHaveLength(1);
    expect(diff?.screens[0]?.changedTriggers).toEqual([
      {
        fromStructureHash: 'struct_a',
        toStructureHash: 'struct_b',
        baseTrigger: 'link',
        targetTrigger: 'click',
        baseSelector: null,
        targetSelector: null,
      },
    ]);
    expect(diff?.summary.triggerChangeCount).toBe(1);
    db.close();
  });
});
