import Link from 'next/link';
import { fetchRuns } from '@/lib/api';
import { cn } from '@/lib/cn';

export default async function HomePage() {
  let runs: Awaited<ReturnType<typeof fetchRuns>> = [];
  let error: string | null = null;
  try {
    runs = await fetchRuns();
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <div className="mx-auto max-w-screen-2xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-1 text-sm text-ink-muted">クロール結果の一覧。新規実行は CLI から:</p>
          <ul className="mt-2 space-y-1 text-xs text-ink-muted">
            <li>
              <code className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-[12px] text-ink">
                make crawl URL=https://example.com
              </code>{' '}
              — 認証不要・即動く 30 秒例
            </li>
            <li>
              <code className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-[12px] text-ink">
                make crawl URL=http://host.docker.internal:3000
              </code>{' '}
              — ホスト上で動いているアプリ (Docker 内から見るため <code>host.docker.internal</code>)
            </li>
          </ul>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-bad/40 bg-bad/10 px-4 py-3 text-sm text-bad">
          API に接続できません: {error}
        </div>
      )}

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
                  {r.run.id} · {new Date(r.run.startedAt).toLocaleString()}
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
          </Link>
        ))}
      </div>
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
