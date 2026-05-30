import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runSchedulerTick } from './scheduler.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      origin_spec TEXT NOT NULL UNIQUE,
      entry_url TEXT NOT NULL,
      defaults_json TEXT NOT NULL DEFAULT '{}',
      schedule_json TEXT NOT NULL DEFAULT '{"enabled":false}',
      last_scheduled_at TEXT,
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
      har_path TEXT,
      stopped_reason TEXT,
      origin TEXT NOT NULL DEFAULT 'manual'
    );
    CREATE TABLE page_states (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      error_count INTEGER NOT NULL DEFAULT 0,
      console_error_count INTEGER NOT NULL DEFAULT 0,
      network_error_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE edges (id TEXT PRIMARY KEY, run_id TEXT NOT NULL);
  `);
  return db;
}

describe('app scheduler', () => {
  it('launches enabled due apps as scheduled runs and records last_scheduled_at', async () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO apps (id, name, origin_spec, entry_url, schedule_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'app_1',
      'Example',
      'https://example.com',
      'https://example.com',
      JSON.stringify({
        enabled: true,
        cron: '* * * * *',
        overrides: { maxDurationSec: 600, notifyOnDiff: true },
        skipIfPreviousStillRunning: true,
      }),
      '2026-05-30T03:00:00.000Z',
    );
    const launch = vi.fn();

    await expect(
      runSchedulerTick({
        getDb: () => db,
        launch,
        now: () => new Date('2026-05-30T03:01:05.000Z'),
      }),
    ).resolves.toBe(1);

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        startUrl: 'https://example.com',
        runOrigin: 'scheduled',
        stopConditions: { combine: 'any', maxDurationSec: 600 },
      }),
    );
    expect(db.prepare(`SELECT last_scheduled_at FROM apps WHERE id = 'app_1'`).get()).toEqual({
      last_scheduled_at: '2026-05-30T03:01:05.000Z',
    });
    db.close();
  });

  it('skips apps with running previous runs when configured', async () => {
    const db = createDb();
    db.prepare(
      `INSERT INTO apps (id, name, origin_spec, entry_url, schedule_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'app_1',
      'Example',
      'https://example.com',
      'https://example.com',
      JSON.stringify({ enabled: true, cron: '* * * * *', skipIfPreviousStillRunning: true }),
      '2026-05-30T03:00:00.000Z',
    );
    db.prepare(
      `INSERT INTO runs (id, app_id, start_url, status, started_at, options_json)
       VALUES ('run_1', 'app_1', 'https://example.com', 'running', '2026-05-30T03:00:00.000Z', '{}')`,
    ).run();
    const launch = vi.fn();

    await expect(
      runSchedulerTick({
        getDb: () => db,
        launch,
        now: () => new Date('2026-05-30T03:01:05.000Z'),
      }),
    ).resolves.toBe(0);
    expect(launch).not.toHaveBeenCalled();
    db.close();
  });
});
