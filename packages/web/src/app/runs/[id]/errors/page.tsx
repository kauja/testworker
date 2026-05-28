import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fetchErrorGroups, fetchGraph } from '@/lib/api';
import { cn } from '@/lib/cn';
import { ErrorGroupRow } from '@/components/error-group-row';

export default async function ErrorsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let groups;
  let graph;
  try {
    // graph は console/network エラーの内訳表示にも使う (#165)。
    // 2 fetch は同時並行で待つ (api は serverside で同居しているため負担は軽い)。
    [groups, graph] = await Promise.all([fetchErrorGroups(id), fetchGraph(id)]);
  } catch {
    notFound();
  }

  const totalCount = groups.reduce((s, g) => s + g.count, 0);
  // ヘッダの「N errors →」(graph-view) は page_errors + console + network の合算。
  // このページは現在 page_errors (= ErrorGroup) のみ集約しているので、 同じ run
  // でもヘッダと不一致になることがある (#165)。 console / network の総数を合わせて
  // 表示し、 ユーザに「0 件は正しい」 と「page_errors 以外もあれば別 view 必要」 を
  // 直感的に伝える。 集計対象は GraphPayload の page_states ぶんの累計。
  const consoleErrors = graph.pages.reduce((s, p) => s + p.consoleErrorCount, 0);
  const networkErrors = graph.pages.reduce((s, p) => s + p.networkErrorCount, 0);
  const otherErrors = consoleErrors + networkErrors;

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
        <SummaryCard label="page_errors (グループ)" value={groups.length} />
        <SummaryCard label="page_errors (合計)" value={totalCount} />
        <SummaryCard
          label="console + network errors"
          value={otherErrors}
          tone={otherErrors > 0 ? 'bad' : 'mute'}
        />
      </div>

      {groups.length === 0 && otherErrors === 0 && (
        <p className="rounded border border-line bg-bg-subtle px-4 py-6 text-center text-sm text-ink-muted">
          このランではエラーは検出されませんでした。
        </p>
      )}

      {groups.length === 0 && otherErrors > 0 && (
        <div className="rounded border border-warn/40 bg-warn/10 px-4 py-4 text-xs text-warn">
          <div className="font-medium uppercase tracking-wider">
            page_errors は 0 件 / その他 {otherErrors} 件
          </div>
          <p className="mt-2 text-ink-muted">
            このページは <code>pageerror</code> / <code>unhandledrejection</code> /{' '}
            <code>crash</code> をスタックトレース fingerprint でグループ化しています (#88)。 graph
            画面の <strong>N errors</strong> には <code>console.error</code> ({consoleErrors} 件) と{' '}
            <code>network &gt;=400</code> ({networkErrors} 件) も含まれるため、 数字が ずれます。
            個別のページ詳細パネル (Console / Network タブ) または report 画面で 確認できます。
            完全な 3 タブ UI は #165 で議論中。
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Link
              href={`/runs/${id}/report`}
              className="rounded border border-warn/60 px-2 py-1 hover:bg-warn/15"
            >
              report で全 errors を見る →
            </Link>
            <Link
              href={`/runs/${id}`}
              className="rounded border border-line px-2 py-1 text-ink-muted hover:border-accent hover:text-accent"
            >
              graph に戻る →
            </Link>
          </div>
        </div>
      )}

      {groups.length > 0 && (
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
