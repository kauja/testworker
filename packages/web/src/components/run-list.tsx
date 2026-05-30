'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import type { RunSummary } from '@testworker/shared';
import { cn } from '@/lib/cn';
import { RunProgress } from './run-progress';
import { StopReasonBadge } from './stop-reason-badge';
import { TimeStamp } from './time-stamp';

export function RunList({ runs }: { runs: RunSummary[] }) {
  const router = useRouter();
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const prefetchRunRoutes = (runId: string) => {
    router.prefetch(`/runs/${runId}`);
    router.prefetch(`/runs/${runId}/errors`);
    router.prefetch(`/runs/${runId}/diff`);
    router.prefetch(`/runs/${runId}/report`);
  };

  return (
    <div className="grid grid-cols-1 gap-3">
      {runs.map((r) => {
        const isNavigating = pendingRunId === r.run.id;
        return (
          <Link
            key={r.run.id}
            href={`/runs/${r.run.id}`}
            onPointerEnter={() => prefetchRunRoutes(r.run.id)}
            onFocus={() => prefetchRunRoutes(r.run.id)}
            onClick={() => {
              startTransition(() => {
                setPendingRunId(r.run.id);
              });
            }}
            aria-busy={(isPending || pendingRunId !== null) && isNavigating}
            className={cn(
              'group rounded-lg border border-line bg-bg-subtle px-5 py-4 transition-colors hover:border-accent-soft hover:bg-bg-panel',
              isNavigating && 'border-accent-soft bg-bg-panel',
            )}
          >
            <div className="flex items-baseline justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{r.run.startUrl}</div>
                <div className="mt-1 text-xs text-ink-faint">
                  {r.run.id} · <TimeStamp value={r.run.startedAt} mode="relative" />
                </div>
              </div>
              <StatusPill status={r.run.status} />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-ink-muted">
              <Stat label="pages" value={r.pageCount} />
              <Stat label="edges" value={r.edgeCount} />
              <Stat
                label="errors"
                value={r.errorCount}
                tone={r.errorCount > 0 ? 'bad' : undefined}
              />
              <StopReasonBadge reason={r.run.stoppedReason} compact />
            </div>
            {(r.run.status === 'running' || r.run.status === 'queued') && (
              <div className="mt-3">
                <RunProgress run={r.run} compact />
              </div>
            )}
            {(r.run.status === 'failed' || r.run.status === 'canceled') && r.run.errorMessage && (
              <div className="mt-3 rounded border border-bad/30 bg-bad/5 px-2 py-1.5 font-mono text-[11px] leading-snug text-bad">
                {firstLineSnippet(r.run.errorMessage, 120)}
              </div>
            )}
          </Link>
        );
      })}
    </div>
  );
}

function firstLineSnippet(message: string, maxLen: number): string {
  const firstLine = message.split('\n')[0]?.trim() ?? '';
  if (firstLine.length <= maxLen) return firstLine;
  return `${firstLine.slice(0, maxLen).trimEnd()}...`;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'bad' | 'ok' }) {
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className={cn('font-mono text-sm', tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">{label}</span>
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    completed: 'bg-ok/15 text-ok border-ok/30',
    running: 'bg-accent/15 text-accent border-accent-soft',
    failed: 'bg-bad/15 text-bad border-bad/30',
    queued: 'bg-warn/15 text-warn border-warn/30',
    canceled: 'bg-ink/10 text-ink-muted border-line',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] uppercase tracking-wider',
        map[status] ?? 'bg-ink/10 text-ink-muted border-line',
      )}
    >
      {status}
    </span>
  );
}
