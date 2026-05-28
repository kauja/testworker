import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchErrorGroups } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ErrorGroupRow } from '@/components/error-group-row';

export default async function ErrorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let groups;
  try {
    groups = await fetchErrorGroups(id);
  } catch {
    notFound();
  }

  const totalCount = groups.reduce((s, g) => s + g.count, 0);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-medium text-ink">エラーグループ</h1>
          <p className="mt-1 text-xs text-ink-muted">
            run <span className="font-mono">{id}</span> 内で同スタックトレース /
            メッセージのエラーを横串集約 (Issue #88)。 「1 個の原因が N
            個のページに影響」を把握する。
          </p>
        </div>
        <Link
          href={`/runs/${id}`}
          className="rounded border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-accent hover:text-accent"
        >
          ← graph view
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3 text-xs">
        <SummaryCard label="グループ数" value={groups.length} />
        <SummaryCard label="エラー総数" value={totalCount} />
        <SummaryCard
          label="最大影響ページ数"
          value={groups[0]?.samplePages.length ?? 0}
          tone={groups[0]?.samplePages.length ? 'bad' : 'mute'}
        />
      </div>

      {groups.length === 0 ? (
        <p className="rounded border border-line bg-bg-subtle px-4 py-6 text-center text-sm text-ink-muted">
          このランではエラーは検出されませんでした。
        </p>
      ) : (
        <ul className="divide-y divide-line rounded border border-line bg-bg-subtle">
          {groups.map((g) => (
            <ErrorGroupRow key={g.fingerprint} group={g} />
          ))}
        </ul>
      )}
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
