import type Database from 'better-sqlite3';
import type { App, RunLaunchInput } from '@testworker/shared';
import { RunLaunchInput as RunLaunchInputSchema, nextFireTime, log } from '@testworker/shared';
import { hasRunningRunForApp, listApps, markAppScheduled } from './queries.js';

export interface SchedulerOptions {
  getDb: () => Database.Database | null;
  launch: (options: RunLaunchInput) => void;
  intervalMs?: number;
  now?: () => Date;
}

export function startAppScheduler(options: SchedulerOptions): NodeJS.Timeout {
  const intervalMs = options.intervalMs ?? Number(process.env.SCHEDULER_TICK_MS ?? 60_000);
  const tick = () =>
    runSchedulerTick(options).catch((err) => {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'scheduler tick failed');
    });
  const timer = setInterval(tick, intervalMs);
  void tick();
  return timer;
}

export async function runSchedulerTick(options: SchedulerOptions): Promise<number> {
  const db = options.getDb();
  if (!db) return 0;
  const now = options.now?.() ?? new Date();
  const due = listApps(db).filter(({ app }) => isAppDue(app, now));
  let launched = 0;
  for (const { app } of due) {
    if (app.schedule.skipIfPreviousStillRunning && hasRunningRunForApp(db, app.id)) continue;
    const launchOptions = scheduledRunOptions(app);
    options.launch(launchOptions);
    markAppScheduled(db, app.id, now.toISOString());
    launched += 1;
  }
  if (launched > 0) log.info({ launched }, 'scheduled runs launched');
  return launched;
}

export function isAppDue(app: App, now: Date): boolean {
  if (!app.schedule.enabled) return false;
  const base = app.lastScheduledAt ? new Date(app.lastScheduledAt) : new Date(app.createdAt);
  try {
    return nextFireTime(app.schedule.cron, base).getTime() <= now.getTime();
  } catch (err) {
    log.warn(
      { appId: app.id, err: err instanceof Error ? err.message : String(err) },
      'bad schedule',
    );
    return false;
  }
}

function scheduledRunOptions(app: App): RunLaunchInput {
  const stopConditions = app.schedule.overrides.maxDurationSec
    ? { combine: 'any' as const, maxDurationSec: app.schedule.overrides.maxDurationSec }
    : undefined;
  return RunLaunchInputSchema.parse({
    startUrl: app.entryUrl,
    appName: app.name,
    originSpec: app.originSpec,
    stopConditions,
    runOrigin: 'scheduled',
  });
}
