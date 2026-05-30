'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import type { App, Schedule } from '@testworker/shared';
import { updateAppSchedule } from '@/lib/api';
import { cn } from '@/lib/cn';
import { nextFireTime, validateCronExpression } from '@/lib/schedule';

const PRESETS = [
  { id: 'daily', label: 'Every day 03:00', cron: '0 3 * * *' },
  { id: 'hourly', label: 'Hourly', cron: '0 * * * *' },
  { id: 'weekday', label: 'Weekday 09:00', cron: '0 9 * * 1-5' },
  { id: 'custom', label: 'Custom', cron: '' },
] as const;

export function SchedulePanel({ app }: { app: App }) {
  const [isPending, startTransition] = useTransition();
  const [schedule, setSchedule] = useState<Schedule>(app.schedule);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [preset, setPreset] = useState(
    PRESETS.find((p) => p.cron && p.cron === app.schedule.cron)?.id ?? 'custom',
  );
  const validation = useMemo(() => validateCronExpression(schedule.cron), [schedule.cron]);
  const next = useMemo(() => {
    if (!validation.ok) return null;
    try {
      return nextFireTime(
        schedule.cron,
        app.lastScheduledAt ? new Date(app.lastScheduledAt) : new Date(),
      ).toISOString();
    } catch {
      return null;
    }
  }, [app.lastScheduledAt, schedule.cron, validation.ok]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validation.ok) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const updated = await updateAppSchedule(app.id, schedule);
        setSchedule(updated.schedule);
        setMessage({ tone: 'ok', text: 'Schedule saved.' });
      } catch (err) {
        setMessage({
          tone: 'bad',
          text: err instanceof Error ? err.message : 'Schedule save failed.',
        });
      }
    });
  };

  return (
    <details className="border-b border-line bg-bg-subtle px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-ink">Schedule</summary>
      <form onSubmit={submit} className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="inline-flex items-center gap-2 text-sm text-ink-muted md:col-span-3">
          <input
            type="checkbox"
            checked={schedule.enabled}
            onChange={(e) => setSchedule((s) => ({ ...s, enabled: e.target.checked }))}
            className="size-3.5 rounded border-line bg-bg text-accent"
          />
          Enable automatic crawl
        </label>

        <label className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          When
          <select
            value={preset}
            onChange={(e) => {
              const nextPreset = e.target.value as (typeof PRESETS)[number]['id'];
              setPreset(nextPreset);
              const found = PRESETS.find((p) => p.id === nextPreset);
              if (found?.cron) setSchedule((s) => ({ ...s, cron: found.cron }));
            }}
            className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
          >
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          Cron
          <input
            value={schedule.cron}
            onChange={(e) => {
              setPreset('custom');
              setSchedule((s) => ({ ...s, cron: e.target.value }));
            }}
            className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
          />
        </label>

        <button
          type="submit"
          disabled={isPending || !validation.ok}
          className="h-10 rounded-md border border-accent-soft bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-panel disabled:text-ink-faint"
        >
          {isPending ? 'Saving...' : 'Save'}
        </button>

        <label className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          Timezone
          <input
            value={schedule.timezone ?? ''}
            placeholder="UTC"
            onChange={(e) =>
              setSchedule((s) => ({ ...s, timezone: e.target.value.trim() || undefined }))
            }
            className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
          />
        </label>

        <label className="text-xs font-medium uppercase tracking-wider text-ink-faint">
          Max duration sec
          <input
            type="number"
            min={1}
            max={86_400}
            value={schedule.overrides.maxDurationSec ?? ''}
            onChange={(e) =>
              setSchedule((s) => ({
                ...s,
                overrides: {
                  ...s.overrides,
                  maxDurationSec: e.target.value === '' ? undefined : e.target.valueAsNumber,
                },
              }))
            }
            className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
          />
        </label>

        <div className="grid gap-2 text-xs text-ink-muted md:col-span-3">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={schedule.overrides.notifyOnDiff}
              onChange={(e) =>
                setSchedule((s) => ({
                  ...s,
                  overrides: { ...s.overrides, notifyOnDiff: e.target.checked },
                }))
              }
              className="size-3.5 rounded border-line bg-bg text-accent"
            />
            Notify on diff
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={schedule.skipIfPreviousStillRunning}
              onChange={(e) =>
                setSchedule((s) => ({ ...s, skipIfPreviousStillRunning: e.target.checked }))
              }
              className="size-3.5 rounded border-line bg-bg text-accent"
            />
            Skip if previous run is still running
          </label>
        </div>

        <div className="text-xs text-ink-muted md:col-span-3">
          {validation.ok
            ? `Next: ${next ?? 'not found'} · Last: ${app.lastScheduledAt ?? 'never'}`
            : validation.error}
        </div>
        {message && (
          <div
            className={cn('text-xs md:col-span-3', message.tone === 'ok' ? 'text-ok' : 'text-bad')}
          >
            {message.text}
          </div>
        )}
      </form>
    </details>
  );
}
