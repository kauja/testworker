import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { getApp, getGraph } from '@/lib/server-api';
import { GraphView } from '@/components/graph-view';
import { RunRouteProvider } from '@/components/run-route-context';
import { StopReasonBadge } from '@/components/stop-reason-badge';
import { formatOriginSpec } from '@/lib/origin-spec';

export default async function AppPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail;
  try {
    detail = await getApp(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
  const latest = detail.runs[0] ?? null;
  const graph = latest ? await getGraph(latest.run.id).catch(() => null) : null;

  if (!latest || !graph) {
    return (
      <div className="mx-auto max-w-screen-lg px-6 py-10">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">{detail.app.name}</h1>
          <p className="mt-1 font-mono text-sm text-ink-muted">
            {formatOriginSpec(detail.app.originSpec)}
          </p>
        </div>
        <div className="rounded-lg border border-line bg-bg-subtle px-6 py-10 text-center text-sm text-ink-muted">
          run snapshot がまだありません。
        </div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-3rem)]">
      {latest.run.stoppedReason && (
        <div className="flex min-h-12 items-center border-b border-line bg-bg-subtle px-4 py-3">
          <StopReasonBadge reason={latest.run.stoppedReason} />
        </div>
      )}
      <div className={latest.run.stoppedReason ? 'h-[calc(100%-3rem)]' : 'h-full'}>
        <RunRouteProvider run={latest.run}>
          <GraphView graph={graph} />
        </RunRouteProvider>
      </div>
      <div className="sr-only">
        <h1>{detail.app.name}</h1>
        <Link href={`/runs/${latest.run.id}`}>latest run snapshot</Link>
      </div>
    </div>
  );
}
