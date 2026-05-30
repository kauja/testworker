'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AppSummary } from '@testworker/shared';
import { cn } from '@/lib/cn';
import { formatOriginSpec } from '@/lib/origin-spec';
import { RunProgress } from './run-progress';
import { TimeStamp } from './time-stamp';

export function AppList({ apps }: { apps: AppSummary[] }) {
  const router = useRouter();
  return (
    <div className="grid grid-cols-1 gap-3">
      {apps.map((summary) => {
        const latest = summary.latestRun;
        const active = latest?.run.status === 'queued' || latest?.run.status === 'running';
        return (
          <Link
            key={summary.app.id}
            href={`/apps/${summary.app.id}`}
            onPointerEnter={() => {
              router.prefetch(`/apps/${summary.app.id}`);
              if (latest) router.prefetch(`/runs/${latest.run.id}`);
            }}
            onFocus={() => {
              router.prefetch(`/apps/${summary.app.id}`);
              if (latest) router.prefetch(`/runs/${latest.run.id}`);
            }}
            className="group rounded-lg border border-line bg-bg-subtle px-5 py-4 transition-colors hover:border-accent-soft hover:bg-bg-panel"
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{summary.app.name}</div>
                <div className="mt-1 truncate font-mono text-xs text-ink-faint">
                  {formatOriginSpec(summary.app.originSpec)}
                </div>
              </div>
              <span
                className={cn(
                  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider',
                  active
                    ? 'border-accent-soft bg-accent/15 text-accent'
                    : latest?.run.status === 'failed'
                      ? 'border-bad/30 bg-bad/15 text-bad'
                      : 'border-line bg-ink/10 text-ink-muted',
                )}
              >
                {latest?.run.status ?? 'no runs'}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-6 text-xs text-ink-muted">
              <Stat label="runs" value={summary.runCount} />
              <Stat label="pages" value={latest?.pageCount ?? 0} />
              <Stat label="edges" value={latest?.edgeCount ?? 0} />
              <Stat
                label="errors"
                value={summary.totalErrorCount}
                tone={summary.totalErrorCount > 0 ? 'bad' : undefined}
              />
            </div>
            {latest && (
              <div className="mt-2 text-xs text-ink-faint">
                latest {latest.run.id} · <TimeStamp value={latest.run.startedAt} mode="relative" />
              </div>
            )}
            {latest && active && (
              <div className="mt-3">
                <RunProgress run={latest.run} compact />
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('font-mono text-sm', tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
    </span>
  );
}
