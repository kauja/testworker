'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  type Node,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { GraphPayload, PageState } from '@testworker/shared';
import { cn } from '@/lib/cn';
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
  // ReactFlow v12 の MiniMap は viewport サイズに応じて SVG の shapeRendering
  // 属性を SSR と CSR で変える (`crispEdges` ↔ `geometricPrecision`) ため、
  // Next.js App Router の 'use client' コンポーネントでも SSR pass で
  // hydration mismatch が出る (#183)。 client mount 後だけ描画する。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // minimap は 22 pages 程度の run でも画面の 1/4 弱を占め、 graph 本体に被る (#166)。
  // default off + toggle で「観察」 と「俯瞰」 を分離する。 m キーでも toggle 可。
  const [minimapVisible, setMinimapVisible] = useState(false);

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
  const slowPages = useMemo(() => {
    return graph.pages
      .map((page) => {
        const primary = primaryPerfMetric(page);
        return primary ? { page, primary } : null;
      })
      .filter((item): item is { page: PageState; primary: PerfMetric } => item !== null)
      .sort((a, b) => b.primary.score - a.primary.score || a.page.url.localeCompare(b.page.url))
      .slice(0, 5);
  }, [graph.pages]);

  const isFailed = graph.run.status === 'failed' || graph.run.status === 'canceled';

  return (
    <div className="relative grid h-full grid-cols-[1fr_360px]">
      <div className="relative">
        {isFailed && (
          <div
            role="alert"
            className="absolute inset-x-0 top-0 z-20 border-b border-bad/40 bg-bad/10 px-6 py-3 text-xs text-bad"
          >
            <div className="font-medium uppercase tracking-wider">
              この run は {graph.run.status} 状態で終了しました
            </div>
            {graph.run.errorMessage ? (
              <pre className="mt-1.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                {graph.run.errorMessage}
              </pre>
            ) : (
              <div className="mt-1.5 text-ink-muted">
                error message が記録されていません。 runner のログ (<code>make logs</code>)
                を確認してください。
              </div>
            )}
            <div className="mt-1.5 text-[10px] text-ink-muted">
              関連:{' '}
              <a
                href="https://github.com/kauja/testworker/blob/main/docs/troubleshooting.md"
                className="underline hover:text-accent"
                target="_blank"
                rel="noreferrer"
              >
                docs/troubleshooting.md
              </a>
            </div>
          </div>
        )}
        <div
          className={cn(
            'absolute left-4 z-10 flex items-center gap-3 rounded-md border border-line bg-bg-panel/80 px-3 py-2 text-xs backdrop-blur',
            isFailed ? 'top-24' : 'top-4',
          )}
        >
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
          // 初期表示で graph 全体が画面に収まるようにする (#166)。
          // padding を 0.1 まで絞ると 22 pages の run でも横方向の空白が消える。
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.2}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => setSelectedId(n.id)}
          aria-label="画面遷移グラフ (screen transition graph)"
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#1c222b" />
          <Controls
            showInteractive={false}
            // Next.js DevTools の N アイコンと左下端で被るのを避ける (#166)。
            position="bottom-right"
          />
          {mounted && minimapVisible && (
            <MiniMap
              pannable
              zoomable
              nodeColor="#222831"
              maskColor="rgba(11,13,16,0.7)"
              position="top-right"
              style={{ width: 160, height: 110 }}
            />
          )}
          <Panel position="bottom-left">
            <button
              type="button"
              onClick={() => setMinimapVisible((v) => !v)}
              className="rounded border border-line bg-bg-panel/80 px-2 py-1 text-[10px] uppercase tracking-wider text-ink-muted backdrop-blur hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              aria-pressed={minimapVisible}
              title="minimap の表示を切り替え"
            >
              {minimapVisible ? 'minimap: on' : 'minimap: off'}
            </button>
          </Panel>
          {slowPages.length > 0 && (
            <Panel position="top-right">
              <div className="max-w-[300px] rounded border border-line bg-bg-panel/80 p-2 text-[11px] backdrop-blur">
                <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">
                  Performance Top 5
                </div>
                <ol className="space-y-1">
                  {slowPages.map(({ page, primary }) => (
                    <li key={page.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(page.id)}
                        className="grid w-full grid-cols-[1fr_auto] items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-bg-subtle focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
                      >
                        <span className="truncate text-ink-muted">{page.title || page.url}</span>
                        <span className={cn('font-mono', perfToneClass(primary.tone))}>
                          {primary.label} {formatPerfValue(primary)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </Panel>
          )}
        </ReactFlow>
      </div>
      <PageDetailPanel pageId={selectedId} onSelectPage={setSelectedId} />
    </div>
  );
}

type PerfTone = 'good' | 'needs-improvement' | 'poor';
type PerfMetric = {
  label: 'LCP' | 'FCP' | 'TTFB' | 'INP';
  value: number;
  unit: 'ms';
  tone: PerfTone;
  score: number;
};

function primaryPerfMetric(page: PageState): PerfMetric | null {
  const candidates: Array<PerfMetric | null> = [
    msMetric('LCP', page.metrics.lcp, [2500, 4000]),
    msMetric('INP', page.metrics.inp, [200, 500]),
    msMetric('FCP', page.metrics.fcp, [1800, 3000]),
    msMetric('TTFB', page.metrics.ttfb, [800, 1800]),
  ];
  return (
    candidates.filter((m): m is PerfMetric => m !== null).sort((a, b) => b.score - a.score)[0] ??
    null
  );
}

function msMetric(
  label: PerfMetric['label'],
  value: number | null | undefined,
  thresholds: [number, number],
): PerfMetric | null {
  if (typeof value !== 'number') return null;
  const [good, poor] = thresholds;
  const tone: PerfTone = value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
  const score = value / poor + (tone === 'poor' ? 2 : tone === 'needs-improvement' ? 1 : 0);
  return { label, value, unit: 'ms', tone, score };
}

function perfToneClass(tone: PerfTone): string {
  switch (tone) {
    case 'good':
      return 'text-ok';
    case 'needs-improvement':
      return 'text-warn';
    case 'poor':
      return 'text-bad';
  }
}

function formatPerfValue(metric: PerfMetric): string {
  return `${Math.round(metric.value)} ${metric.unit}`;
}
