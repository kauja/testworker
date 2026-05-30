import { ApiError, fetchApps } from '@/lib/api';
import { AppList } from '@/components/app-list';
import { NewRunForm } from '@/components/new-run-form';
import { RetryButton } from '@/components/retry-button';
import { RunsAutoRefresh } from '@/components/runs-auto-refresh';

interface PageError {
  kind: 'unreachable' | 'db_not_ready' | 'http';
  message: string;
  hint?: string;
}

export default async function HomePage() {
  let apps: Awaited<ReturnType<typeof fetchApps>> = [];
  let error: PageError | null = null;
  try {
    apps = await fetchApps();
  } catch (e) {
    if (e instanceof ApiError) {
      error = { kind: e.kind, message: e.message, hint: e.hint };
    } else {
      error = { kind: 'http', message: e instanceof Error ? e.message : String(e) };
    }
  }
  const hasActiveRun = apps.some(
    (a) => a.latestRun?.run.status === 'queued' || a.latestRun?.run.status === 'running',
  );
  const recentUrls = Array.from(new Set(apps.map((a) => a.app.entryUrl))).slice(0, 8);

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-10">
      {hasActiveRun && <RunsAutoRefresh />}
      <div className="mb-8">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Apps</h1>
          <p className="mt-1 text-sm text-ink-muted">検査対象 App と新規 Run。</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <div className="min-w-0">
          {error && <ApiErrorBanner error={error} />}

          {!error && apps.length === 0 && (
            <div className="rounded-lg border border-dashed border-line bg-bg-subtle px-6 py-12 text-center text-sm text-ink-muted">
              まだ app がありません。
            </div>
          )}

          <AppList apps={apps} />
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
