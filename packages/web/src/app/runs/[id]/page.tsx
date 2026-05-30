import { getGraph, getRun } from '@/lib/server-api';
import { GraphView } from '@/components/graph-view';
import { AutoRefresh } from '@/components/auto-refresh';
import { RunProgress } from '@/components/run-progress';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);

  const isLive = run.status === 'running' || run.status === 'queued';
  const graph = await getGraph(id).catch(() => null);

  return (
    <div className="h-[calc(100dvh-3rem)]">
      {isLive && <AutoRefresh />}
      {isLive && (
        <div className="border-b border-line bg-bg-subtle px-4 py-3">
          <RunProgress run={run} />
        </div>
      )}
      <div className={isLive ? 'h-[calc(100%-5.5rem)]' : 'h-full'}>
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
