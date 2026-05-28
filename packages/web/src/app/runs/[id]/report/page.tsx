import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchErrorGroups, fetchGraph } from '@/lib/api';
import { cn } from '@/lib/cn';
import { PrintButton } from '@/components/print-button';

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
  let errorGroups;
  try {
    graph = await fetchGraph(id);
    errorGroups = await fetchErrorGroups(id);
  } catch {
    notFound();
  }

  const sortedPages = [...graph.pages].sort((a, b) => {
    const errA = a.errorCount + a.consoleErrorCount + a.networkErrorCount;
    const errB = b.errorCount + b.consoleErrorCount + b.networkErrorCount;
    return errB - errA || a.depth - b.depth || a.url.localeCompare(b.url);
  });

  const totalErrors = graph.pages.reduce(
    (s, p) => s + p.errorCount + p.consoleErrorCount + p.networkErrorCount,
    0,
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-6 print:max-w-full print:px-0 print:py-0">
      <header className="mb-6 flex items-start justify-between gap-3 print:mb-4">
        <div>
          <h1 className="text-2xl font-medium text-ink">testworker run report</h1>
          <p className="mt-1 text-xs text-ink-muted">
            <span className="font-mono">{id}</span> · start: {graph.run.startUrl} · started{' '}
            {new Date(graph.run.startedAt).toLocaleString()}
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
          label="error groups"
          value={errorGroups.length}
          tone={errorGroups.length > 0 ? 'bad' : 'mute'}
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
              return (
                <tr
                  key={p.id}
                  className={cn(
                    'border-b border-line align-top',
                    totalErr > 0 ? 'text-ink' : 'text-ink-muted',
                  )}
                >
                  <td className="px-2 py-1.5 font-mono">{p.depth}</td>
                  <td className="px-2 py-1.5">
                    <div className="font-medium">{p.title || '(untitled)'}</div>
                    <div className="truncate font-mono text-[10px] text-ink-muted">{p.url}</div>
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right font-mono',
                      p.errorCount > 0 && 'text-bad',
                    )}
                  >
                    {p.errorCount}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right font-mono',
                      p.consoleErrorCount > 0 && 'text-bad',
                    )}
                  >
                    {p.consoleErrorCount}
                  </td>
                  <td
                    className={cn(
                      'px-2 py-1.5 text-right font-mono',
                      p.networkErrorCount > 0 && 'text-bad',
                    )}
                  >
                    {p.networkErrorCount}
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
          エラーグループ ({errorGroups.length})
        </h2>
        {errorGroups.length === 0 ? (
          <p className="rounded border border-line bg-bg-subtle px-3 py-3 text-xs text-ink-muted">
            このランではエラーは検出されませんでした。
          </p>
        ) : (
          <ul className="space-y-3">
            {errorGroups.map((g) => (
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
