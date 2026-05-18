import { notFound } from 'next/navigation';
import { fetchGraph } from '@/lib/api';
import { GraphView } from '@/components/graph-view';

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let graph;
  try {
    graph = await fetchGraph(id);
  } catch {
    notFound();
  }
  return (
    <div className="h-[calc(100dvh-3rem)]">
      <GraphView graph={graph} />
    </div>
  );
}
