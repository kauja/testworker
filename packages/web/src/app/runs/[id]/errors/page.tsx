import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchRunErrors } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ErrorGroupRow } from '@/components/error-group-row';

export default async function ErrorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let errors;
  try {
    errors = await fetchRunErrors(id);
  } catch {
    notFound();
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">Run errors</h1>
          <p className="mt-1 text-xs text-ink-muted">
            run <span className="font-mono">{id}</span> 内の page errors / console errors / network
            errors を同じ合計で確認する。
          </p>
        </div>
        <Link
          href={`/runs/${id}`}
          className="rounded border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
        >
          ← graph view
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs md:grid-cols-4">
        <SummaryCard
          label="total errors"
          value={errors.totals.all}
          tone={errors.totals.all > 0 ? 'bad' : 'mute'}
        />
        <SummaryCard
          label="page errors"
          value={errors.totals.pageErrors}
          tone={errors.totals.pageErrors > 0 ? 'bad' : 'mute'}
        />
        <SummaryCard
          label="console errors"
          value={errors.totals.consoleErrors}
          tone={errors.totals.consoleErrors > 0 ? 'bad' : 'mute'}
        />
        <SummaryCard
          label="network errors"
          value={errors.totals.networkErrors}
          tone={errors.totals.networkErrors > 0 ? 'bad' : 'mute'}
        />
      </div>

      {errors.totals.all === 0 && (
        <p className="rounded border border-line bg-bg-subtle px-4 py-6 text-center text-sm text-ink-muted">
          このランではエラーは検出されませんでした。
        </p>
      )}

      {errors.totals.all > 0 && (
        <div className="space-y-6">
          <section>
            <SectionHeader
              title="Page error groups"
              count={errors.pageErrorGroups.length}
              meta={`${errors.totals.pageErrors} events`}
            />
            {errors.pageErrorGroups.length === 0 ? (
              <EmptySection label="pageerror / unhandledrejection / crash はありません。" />
            ) : (
              <ul className="divide-y divide-line rounded border border-line bg-bg-subtle">
                {errors.pageErrorGroups.map((group) => (
                  <ErrorGroupRow key={group.fingerprint} group={group} />
                ))}
              </ul>
            )}
          </section>

          <section>
            <SectionHeader title="Console errors" count={errors.consoleErrors.length} />
            {errors.consoleErrors.length === 0 ? (
              <EmptySection label="console.error はありません。" />
            ) : (
              <div className="overflow-hidden rounded border border-line bg-bg-subtle">
                <table className="w-full table-fixed text-xs">
                  <thead className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                    <tr>
                      <th className="w-[30%] px-3 py-2 font-normal">page</th>
                      <th className="px-3 py-2 font-normal">message</th>
                      <th className="w-[18%] px-3 py-2 font-normal">source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {errors.consoleErrors.map((entry) => (
                      <tr key={entry.id} className="align-top">
                        <td className="px-3 py-2">
                          <PageLink runId={id} page={entry.page} tab="console" />
                        </td>
                        <td className="px-3 py-2">
                          <div className="break-words font-mono text-[11px] text-ink">
                            {entry.text}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] text-ink-muted">
                          {entry.url ?? '(inline)'}
                          {entry.lineNumber != null ? `:${entry.lineNumber}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <SectionHeader title="Network errors" count={errors.networkErrors.length} />
            {errors.networkErrors.length === 0 ? (
              <EmptySection label="failed request / HTTP 4xx / HTTP 5xx はありません。" />
            ) : (
              <div className="overflow-hidden rounded border border-line bg-bg-subtle">
                <table className="w-full table-fixed text-xs">
                  <thead className="border-b border-line text-left text-[10px] uppercase tracking-wider text-ink-faint">
                    <tr>
                      <th className="w-[30%] px-3 py-2 font-normal">page</th>
                      <th className="w-[12%] px-3 py-2 font-normal">status</th>
                      <th className="px-3 py-2 font-normal">request</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {errors.networkErrors.map((entry) => (
                      <tr key={entry.id} className="align-top">
                        <td className="px-3 py-2">
                          <PageLink runId={id} page={entry.page} tab="network" />
                        </td>
                        <td className="px-3 py-2 font-mono text-bad">
                          {entry.failed ? 'failed' : (entry.status ?? 'n/a')}
                        </td>
                        <td className="px-3 py-2">
                          <div className="break-words font-mono text-[11px] text-ink">
                            {entry.method} {entry.url}
                          </div>
                          {entry.failureText && (
                            <div className="mt-1 break-words font-mono text-[10px] text-ink-muted">
                              {entry.failureText}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, count, meta }: { title: string; count: number; meta?: string }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-medium uppercase tracking-wider text-ink-faint">{title}</h2>
      <div className={cn('font-mono text-xs', count > 0 ? 'text-bad' : 'text-ink-muted')}>
        {count}
        {meta ? <span className="ml-2 text-ink-faint">{meta}</span> : null}
      </div>
    </div>
  );
}

function EmptySection({ label }: { label: string }) {
  return (
    <p className="rounded border border-line bg-bg-subtle px-4 py-4 text-sm text-ink-muted">
      {label}
    </p>
  );
}

function PageLink({
  runId,
  page,
  tab,
}: {
  runId: string;
  page: { pageStateId: string; url: string; title: string };
  tab: 'console' | 'network';
}) {
  return (
    <Link
      href={`/runs/${runId}?page=${encodeURIComponent(page.pageStateId)}&tab=${tab}`}
      className="block min-w-0 hover:text-accent"
    >
      <div className="truncate font-medium">{page.title || '(untitled)'}</div>
      <div className="truncate font-mono text-[10px] text-ink-muted">{page.url}</div>
    </Link>
  );
}

function SummaryCard({
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
      <div className={cn('font-mono text-lg', tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}
