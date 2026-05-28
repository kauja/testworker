'use client';

import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphPayload, PageState } from '@testworker/shared';
import { PageNode } from './page-node';
import { PageDetailPanel } from './page-detail-panel';

const NODE_W = 220;
const NODE_H = 132;
const COL_GAP = 120;
const ROW_GAP = 32;

const nodeTypes = { page: PageNode };

function layout(pages: PageState[]): Record<string, { x: number; y: number }> {
  const byDepth = new Map<number, PageState[]>();
  for (const p of pages) {
    const arr = byDepth.get(p.depth) ?? [];
    arr.push(p);
    byDepth.set(p.depth, arr);
  }
  const positions: Record<string, { x: number; y: number }> = {};
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  depths.forEach((d, colIdx) => {
    const items = byDepth.get(d)!;
    items.sort((a, b) => a.visitedAt.localeCompare(b.visitedAt));
    const colHeight = items.length * (NODE_H + ROW_GAP) - ROW_GAP;
    const startY = -colHeight / 2;
    items.forEach((p, rowIdx) => {
      positions[p.id] = {
        x: colIdx * (NODE_W + COL_GAP),
        y: startY + rowIdx * (NODE_H + ROW_GAP),
      };
    });
  });
  return positions;
}

export function GraphView({ graph }: { graph: GraphPayload }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = useMemo<Node[]>(() => {
    const positions = layout(graph.pages);
    return graph.pages.map((p) => ({
      id: p.id,
      type: 'page',
      position: positions[p.id] ?? { x: 0, y: 0 },
      data: { page: p, selected: p.id === selectedId },
      width: NODE_W,
      height: NODE_H,
    }));
  }, [graph.pages, selectedId]);

  const edges = useMemo<RFEdge[]>(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.fromPageStateId,
        target: e.toPageStateId,
        animated: e.trigger === 'spa-route' || e.trigger === 'spa-dom',
        label: e.trigger,
        labelStyle: { fontSize: 10, fill: '#8d96a3' },
        labelBgStyle: { fill: '#15191f' },
      })),
    [graph.edges],
  );

  const errorTotal = graph.pages.reduce(
    (s, p) => s + p.errorCount + p.consoleErrorCount + p.networkErrorCount,
    0,
  );

  return (
    <div className="relative grid h-full grid-cols-[1fr_360px]">
      <div className="relative">
        <div className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-md border border-line bg-bg-panel/80 px-3 py-2 text-xs backdrop-blur">
          <span className="truncate text-ink-muted">{graph.run.startUrl}</span>
          <span className="text-ink-faint">·</span>
          <span className="text-ink">{graph.pages.length} pages</span>
          <span className="text-ink-faint">·</span>
          <span className="text-ink">{graph.edges.length} edges</span>
          {errorTotal > 0 && (
            <>
              <span className="text-ink-faint">·</span>
              <a
                href={`/runs/${graph.run.id}/errors`}
                className="text-bad hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-bad"
                title="エラーグループ表示 (Issue #88)"
              >
                {errorTotal} errors →
              </a>
            </>
          )}
          <span className="text-ink-faint">·</span>
          <a
            href={`/runs/${graph.run.id}/diff`}
            className="text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            title="1 つ前の run との差分を表示 (Intent #125)"
          >
            diff →
          </a>
          <span className="text-ink-faint">·</span>
          <a
            href={`/runs/${graph.run.id}/report`}
            className="text-ink-muted hover:text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            title="静的レポート (印刷 / PDF 保存) Intent #127"
          >
            report →
          </a>
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          aria-label="画面遷移グラフ (screen transition graph)"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1c222b" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable nodeColor="#222831" maskColor="rgba(11,13,16,0.7)" />
        </ReactFlow>
      </div>
      <PageDetailPanel pageId={selectedId} onSelectPage={setSelectedId} />
    </div>
  );
}
