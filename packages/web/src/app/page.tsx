import Link from 'next/link';
import { ApiError, fetchRuns } from '@/lib/api';
import { cn } from '@/lib/cn';
import { NewRunForm } from '@/components/new-run-form';
import { RetryButton } from '@/components/retry-button';
import { RunsAutoRefresh } from '@/components/runs-auto-refresh';
import { TimeStamp } from '@/components/time-stamp';
import { RunProgress } from '@/components/run-progress';

interface PageError {
  kind: 'unreachable' | 'db_not_ready' | 'http';
  message: string;
  hint?: string;
}

export default async function HomePage() {
  let runs: Awaited<ReturnType<typeof fetchRuns>> = [];
  let error: PageError | null = null;
  try {
    runs = await fetchRuns();
  } catch (e) {
    if (e instanceof ApiError) {
      error = { kind: e.kind, message: e.message, hint: e.hint };
    } else {
      error = { kind: 'http', message: e instanceof Error ? e.message : String(e) };
    }
  }
  const hasActiveRun = runs.some((r) => r.run.status === 'queued' || r.run.status === 'running');
  const recentUrls = Array.from(new Set(runs.map((r) => r.run.startUrl))).slice(0, 8);

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-10">
      {hasActiveRun && <RunsAutoRefresh />}
      <div className="mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-1 text-sm text-ink-muted">クロール結果と新規 Run。</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <div className="min-w-0">
          {error && <ApiErrorBanner error={error} />}

          {!error && runs.length === 0 && (
            <div className="rounded-lg border border-dashed border-line bg-bg-subtle px-6 py-12 text-center text-sm text-ink-muted">
              まだ run がありません。
            </div>
          )}

          <div className="grid grid-cols-1 gap-3">
            {runs.map((r) => (
              <Link
                key={r.run.id}
                href={`/runs/${r.run.id}`}
                className="group rounded-lg border border-line bg-bg-subtle px-5 py-4 transition-colors hover:border-accent-soft hover:bg-bg-panel"
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
                <div className="mt-3 flex items-center gap-6 text-xs text-ink-muted">
                  <Stat label="pages" value={r.pageCount} />
                  <Stat label="edges" value={r.edgeCount} />
                  <Stat
                    label="errors"
                    value={r.errorCount}
                    tone={r.errorCount > 0 ? 'bad' : undefined}
                  />
                </div>
                {(r.run.status === 'running' || r.run.status === 'queued') && (
                  <div className="mt-3">
                    <RunProgress run={r.run} compact />
                  </div>
                )}
              </Link>
            ))}
          </div>
        </div>
        <NewRunForm recentUrls={recentUrls} />
      </div>
    </div>
  );
}

function ApiErrorBanner({ error }: { error: PageError }) {
  const title =
    error.kind === 'db_not_ready'
      ? 'データベース未初期化'
      : error.kind === 'unreachable'
        ? 'API server に到達できません'
        : 'API エラー';
  const defaultHint =
    error.kind === 'db_not_ready'
      ? '`make migrate` (または `pnpm --filter @testworker/runner run db:migrate`) を実行してから「再試行」してください。'
      : error.kind === 'unreachable'
        ? '`make up` で api コンテナが起動しているか、 ポート 3001 が listen 状態か確認してください。'
        : null;
  const hint = error.hint ?? defaultHint;
  return (
    <div className="space-y-2 rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-bad">{title}</div>
        <RetryButton />
      </div>
      {hint && <div className="text-xs text-ink-muted">{hint}</div>}
      <details className="text-xs text-ink-faint">
        <summary className="cursor-pointer hover:text-ink-muted">技術詳細</summary>
        <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px]">
          {error.message}
        </pre>
      </details>
    </div>
  );
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
