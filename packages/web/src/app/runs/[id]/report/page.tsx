import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchGraph, fetchRunErrors } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PrintButton } from '@/components/print-button';
import { TimeStamp } from '@/components/time-stamp';
import { computePageLabels } from '@/lib/page-label';

/**
 * Run の静的レポート (Intent #127 / Bolt: 静的レポート HTML エクスポート)。
 *
 * Server Component で run + graph + error groups を 1 HTML にまとめる。
 * 「印刷 / PDF 保存」ボタンで window.print() を呼び、 ブラウザの「PDF として保存」で
 * 1 ファイル (印刷時は背景色も維持する設定 + 自分のスクリーンショットは absolute URL
 * のまま残す) になる。 メール / Slack 共有用の portable artifact として動作する。
 */
export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let graph;
  let errors;
  try {
    [graph, errors] = await Promise.all([fetchGraph(id), fetchRunErrors(id)]);
  } catch {
    notFound();
  }

  const sortedPages = [...graph.pages].sort((a, b) => {
    const errA = a.errorCount + a.consoleErrorCount + a.networkErrorCount;
    const errB = b.errorCount + b.consoleErrorCount + b.networkErrorCount;
    return errB - errA || a.depth - b.depth || a.url.localeCompare(b.url);
  });
  // 同 title 重複 (例: 全部 "testworker") を URL path で差別化 (#174)。
  const labels = computePageLabels(graph.pages);

  const totalErrors = errors.totals.all;

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 print:max-w-full print:px-0 print:py-0">
      <header className="mb-6 flex items-start justify-between gap-3 print:mb-4">
        <div>
          <h1 className="text-2xl font-medium text-ink">testworker run report</h1>
          <p className="mt-1 text-xs text-ink-muted">
            <span className="font-mono">{id}</span> · start: {graph.run.startUrl} · started{' '}
            <TimeStamp
              value={graph.run.startedAt}
              options={{ dateStyle: 'medium', timeStyle: 'short' }}
            />
          </p>
        </div>
        <nav className="flex gap-2 text-xs print:hidden" aria-label="report navigation">
          <PrintButton />
          <Link
            href={`/runs/${id}`}
            className="rounded border border-line px-3 py-1.5 text-ink-muted hover:border-accent hover:text-accent"
          >
            ← graph view
          </Link>
        </nav>
      </header>

      <section className="mb-6 grid grid-cols-4 gap-3 text-xs print:grid-cols-4">
        <Counter label="pages" value={graph.pages.length} />
        <Counter label="edges" value={graph.edges.length} />
        <Counter label="total errors" value={totalErrors} tone={totalErrors > 0 ? 'bad' : 'mute'} />
        <Counter
          label="page error groups"
          value={errors.pageErrorGroups.length}
          tone={errors.pageErrorGroups.length > 0 ? 'bad' : 'mute'}
        />
      </section>

      <section className="mb-6 grid grid-cols-3 gap-3 text-xs print:grid-cols-3">
        <Counter
          label="page errors"
          value={errors.totals.pageErrors}
          tone={errors.totals.pageErrors > 0 ? 'bad' : 'mute'}
        />
        <Counter
          label="console errors"
          value={errors.totals.consoleErrors}
          tone={errors.totals.consoleErrors > 0 ? 'bad' : 'mute'}
        />
        <Counter
          label="network errors"
          value={errors.totals.networkErrors}
          tone={errors.totals.networkErrors > 0 ? 'bad' : 'mute'}
        />
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-ink-faint">
          ページ一覧 (影響度順)
        </h2>
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wider text-ink-faint">
            <tr className="border-b border-line">
              <th className="px-2 py-1.5 font-normal">depth</th>
              <th className="px-2 py-1.5 font-normal">title / url</th>
              <th className="px-2 py-1.5 text-right font-normal">errors</th>
              <th className="px-2 py-1.5 text-right font-normal">console</th>
              <th className="px-2 py-1.5 text-right font-normal">net</th>
            </tr>
          </thead>
          <tbody>
            {sortedPages.map((p) => {
              const totalErr = p.errorCount + p.consoleErrorCount + p.networkErrorCount;
              // 行クリック → graph view で該当 page を選択して開く (#189)。
              // tab パラメタを変えれば該当タブで着地する (将来 #178 で完全実装)。
              const baseHref = `/runs/${id}?page=${encodeURIComponent(p.id)}`;
              const consoleHref = `${baseHref}&tab=console`;
              const networkHref = `${baseHref}&tab=network`;
              const errorsHref = `${baseHref}&tab=errors`;
              return (
                <tr
                  key={p.id}
                  className={cn(
                    'border-b border-line align-top transition-colors hover:bg-bg-panel/40 print:hover:bg-transparent',
                    totalErr > 0 ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  <td className="px-2 py-1.5 font-mono">{p.depth}</td>
                  <td className="px-2 py-1.5">
                    <Link
                      href={baseHref}
                      className="block hover:text-accent print:hover:text-inherit"
                    >
                      <div className="font-medium" title={p.title}>
                        {labels.get(p.id) ?? p.title ?? '(untitled)'}
                      </div>
                      <div className="truncate font-mono text-[10px] text-ink-muted">{p.url}</div>
                    </Link>
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right font-mono',
                      p.errorCount > 0 && 'text-bad',
                    )}
                  >
                    {p.errorCount > 0 ? (
                      <Link href={errorsHref} className="hover:underline">
                        {p.errorCount}
                      </Link>
                    ) : (
                      <span>{p.errorCount}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right font-mono',
                      p.consoleErrorCount > 0 && 'text-bad',
                    )}
                  >
                    {p.consoleErrorCount > 0 ? (
                      <Link href={consoleHref} className="hover:underline">
                        {p.consoleErrorCount}
                      </Link>
                    ) : (
                      <span>{p.consoleErrorCount}</span>
                    )}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right font-mono',
                      p.networkErrorCount > 0 && 'text-bad',
                    )}
                  >
                    {p.networkErrorCount > 0 ? (
                      <Link href={networkHref} className="hover:underline">
                        {p.networkErrorCount}
                      </Link>
                    ) : (
                      <span>{p.networkErrorCount}</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {sortedPages.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-4 text-center text-ink-muted">
                  ページ無し
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium uppercase tracking-wider text-ink-faint">
          Page error groups ({errors.pageErrorGroups.length})
        </h2>
        {errors.pageErrorGroups.length === 0 ? (
          <p className="rounded border border-line bg-bg-subtle px-3 py-3 text-xs text-ink-muted">
            pageerror / unhandledrejection / crash は検出されませんでした。
            {errors.totals.consoleErrors + errors.totals.networkErrors > 0
              ? ' console / network errors は上の内訳とページ一覧で確認できます。'
              : ''}
          </p>
        ) : (
          <ul className="space-y-3">
            {errors.pageErrorGroups.map((g) => (
              <li key={g.fingerprint} className="rounded border border-line bg-bg-subtle p-3">
                <div className="flex items-center gap-2 text-[10px] text-ink-faint">
                  <span className="rounded bg-bad/15 px-1.5 py-0.5 font-mono text-bad">
                    ×{g.count}
                  </span>
                  <span className="rounded bg-bad/15 px-1.5 py-0.5 text-bad">{g.kind}</span>
                  <span>{g.samplePages.length} pages affected</span>
                  <span className="font-mono">{g.fingerprint}</span>
                </div>
                <div className="mt-1.5 break-words font-mono text-[12px] text-ink">{g.message}</div>
                {g.stack && (
                  <pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-panel p-2 font-mono text-[10px] text-ink-muted print:max-h-none">
                    {g.stack}
                  </pre>
                )}
                {g.samplePages.length > 0 && (
                  <div className="mt-1.5 text-[10px] text-ink-muted">
                    sample: {g.samplePages.map((p) => p.url).join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="mt-8 border-t border-line pt-3 text-[10px] text-ink-faint">
        generated by testworker · {new Date().toISOString()} · run {id}
      </footer>
    </div>
  );
}

function Counter({
  label,
  value,
  tone = 'mute',
}: {
  label: string;
  value: number;
  tone?: 'bad' | 'mute';
}) {
  return (
    <div className="rounded border border-line bg-bg-subtle px-3 py-2">
      <div className={cn('font-mono text-xl', tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}
