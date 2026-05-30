import { getGraph, getRun } from '@/lib/server-api';
import { GraphView } from '@/components/graph-view';
import { AutoRefresh } from '@/components/auto-refresh';
import { RunOriginBadge } from '@/components/run-origin-badge';
import { RunProgress } from '@/components/run-progress';
import { StopReasonBadge } from '@/components/stop-reason-badge';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);

  const isLive = run.status === 'running' || run.status === 'queued';
  const graph = await getGraph(id).catch(() => null);
  const hasHeader = isLive || Boolean(run.stoppedReason) || run.origin !== 'manual';

  return (
    <div className="h-[calc(100dvh-3rem)]">
      {isLive && <AutoRefresh />}
      {hasHeader && (
        <div className="flex min-h-12 items-center gap-2 border-b border-line bg-bg-subtle px-4 py-3">
          <RunOriginBadge origin={run.origin} />
          {isLive ? <RunProgress run={run} /> : <StopReasonBadge reason={run.stoppedReason} />}
        </div>
      )}
      <div className={hasHeader ? 'h-[calc(100%-3rem)]' : 'h-full'}>
        {graph ? (
          <GraphView graph={graph} />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-ink-muted">
            graph をまだ取得できません… (走行中の最初のページが完了すると表示されます)
          </div>
        )}
      </div>
    </div>
  );
}
