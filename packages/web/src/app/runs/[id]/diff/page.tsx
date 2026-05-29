import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { RunDiffPage } from '@testworker/shared';
import { fetchRunDiff } from '@/lib/api';
import { cn } from '@/lib/cn';

interface SearchParams {
  base?: string;
  showFlaky?: string;
}

export default async function DiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const baseQuery = sp.base ?? 'previous';
  const showFlaky = sp.showFlaky === '1' || sp.showFlaky === 'true';

  let diff;
  try {
    diff = await fetchRunDiff(id, baseQuery, showFlaky);
  } catch (err) {
    // base が指定なしで前 run が無い場合は 404 になる → 明示的にメッセージ
    const msg = err instanceof Error ? err.message : String(err);
    if (/no_previous_run/.test(msg) || /404/.test(msg)) {
      return (
        <div className="mx-auto max-w-3xl px-6 py-10 text-sm text-ink-muted">
          <h1 className="mb-2 text-xl font-medium text-ink">差分ビュー</h1>
          <p>
            run <span className="font-mono">{id}</span> の比較対象 (1 つ前の run)
            が見つかりませんでした。 <code>?base=&lt;runId&gt;</code> を URL
            に付けて比較先を指定するか、 別の run を選んでください。
          </p>
          <p className="mt-3">
            <Link href={`/runs/${id}`} className="text-accent hover:underline">
              ← graph view に戻る
            </Link>
          </p>
        </div>
      );
    }
    notFound();
  }

  const { summary } = diff;
  const topNew = diff.newPages.slice(0, 5);
  const topRemoved = diff.removedPages.slice(0, 5);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Run 差分ビュー</h1>
          <p className="mt-1 text-xs text-ink-muted">
            base <span className="font-mono">{diff.baseRunId}</span> → target{' '}
            <span className="font-mono">{diff.targetRunId}</span> (Intent #125 / Issue #85)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {summary.flakyHiddenCount > 0 || showFlaky ? (
            <Link
              href={`/runs/${id}/diff?base=${encodeURIComponent(baseQuery)}&showFlaky=${showFlaky ? '0' : '1'}`}
              className={cn(
                'rounded border px-3 py-1.5 text-xs',
                showFlaky
                  ? 'border-warn/50 text-warn hover:border-warn'
                  : 'border-line text-ink-muted hover:border-accent hover:text-accent',
              )}
            >
              {showFlaky ? 'Hide flaky' : `Show flaky (${summary.flakyHiddenCount})`}
            </Link>
          ) : null}
          <Link
            href={`/runs/${id}`}
            className="rounded border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
          >
            ← graph view
          </Link>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-6 gap-3 text-xs">
        <SummaryCard label="base 総ページ数" value={summary.baseTotal} />
        <SummaryCard label="target 総ページ数" value={summary.targetTotal} />
        <SummaryCard
          label="新規ページ"
          value={summary.newCount}
          tone={summary.newCount > 0 ? 'accent' : 'mute'}
        />
        <SummaryCard
          label="削除ページ"
          value={summary.removedCount}
          tone={summary.removedCount > 0 ? 'bad' : 'mute'}
        />
        <SummaryCard label="共通ページ" value={summary.commonCount} />
        <SummaryCard label="flaky hidden" value={summary.flakyHiddenCount} tone="warn" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <DiffSection
          title="新規ページ"
          emptyLabel="新規ページなし"
          pages={topNew}
          allCount={diff.newPages.length}
          tone="accent"
          targetRunId={id}
        />
        <DiffSection
          title="削除されたページ"
          emptyLabel="削除ページなし"
          pages={topRemoved}
          allCount={diff.removedPages.length}
          tone="bad"
          targetRunId={diff.baseRunId}
        />
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone = 'mute',
}: {
  label: string;
  value: number;
  tone?: 'accent' | 'bad' | 'warn' | 'mute';
}) {
  return (
    <div className="rounded border border-line bg-bg-subtle px-3 py-2">
      <div
        className={cn(
          'font-mono text-lg',
          tone === 'accent'
            ? 'text-accent'
            : tone === 'bad'
              ? 'text-bad'
              : tone === 'warn'
                ? 'text-warn'
                : 'text-ink',
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}

function DiffSection({
  title,
  emptyLabel,
  pages,
  allCount,
  tone,
  targetRunId,
}: {
  title: string;
  emptyLabel: string;
  pages: RunDiffPage[];
  allCount: number;
  tone: 'accent' | 'bad';
  targetRunId: string;
}) {
  return (
    <section className="rounded border border-line bg-bg-subtle">
      <header
        className={cn(
          'flex items-baseline justify-between border-b border-line px-3 py-2 text-xs',
          tone === 'accent' ? 'text-accent' : 'text-bad',
        )}
      >
        <span className="font-medium uppercase tracking-wider">{title}</span>
        <span className="font-mono text-ink-faint">
          showing {pages.length} of {allCount}
        </span>
      </header>
      {pages.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-line text-xs">
          {pages.map((p) => {
            const errSum = p.errorCount + p.consoleErrorCount + p.networkErrorCount;
            return (
              <li key={p.pageStateId} className="px-3 py-2">
                <Link
                  href={`/runs/${targetRunId}`}
                  className="block"
                  title={`signature: ${p.signature}`}
                >
                  <div className="flex items-center gap-2 text-[10px] text-ink-faint">
                    <span className="rounded bg-bg-panel px-1.5 py-0.5">depth {p.depth}</span>
                    {errSum > 0 && (
                      <span className="rounded bg-bad/15 px-1.5 py-0.5 text-bad">{errSum} err</span>
                    )}
                    {p.flaky && (
                      <span className="rounded bg-warn/15 px-1.5 py-0.5 text-warn">
                        flaky {p.stabilityScore == null ? '' : p.stabilityScore.toFixed(2)}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate font-medium text-ink hover:text-accent">
                    {p.title || '(untitled)'}
                  </div>
                  <div className="truncate font-mono text-[11px] text-ink-muted">{p.url}</div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
