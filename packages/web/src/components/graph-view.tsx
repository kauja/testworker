'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
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
import type { Edge, GraphPayload, PageState } from '@testworker/shared';
import { cn } from '@/lib/cn';
import { harDownloadUrl } from '@/lib/api';
import { computePageLabels } from '@/lib/page-label';
import { PageNode } from './page-node';
import { DETAIL_TABS, PageDetailPanel, type DetailTab } from './page-detail-panel';
import { useRunRoute } from './run-route-context';

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
  const routeRun = useRunRoute();
  const run = routeRun.id === graph.run.id ? routeRun : graph.run;
  // report 等から `/runs/<id>?page=<pid>` で deep-link されたときに initial 選択
  // 状態として反映する (#189)。 該当 page が graph に無ければ null。
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageIds = useMemo(() => new Set(graph.pages.map((p) => p.id)), [graph.pages]);
  const sortedPages = useMemo(
    () => [...graph.pages].sort((a, b) => a.visitedAt.localeCompare(b.visitedAt)),
    [graph.pages],
  );
  const selectedFromUrl = (() => {
    const requested = searchParams.get('node') ?? searchParams.get('page');
    if (!requested) return null;
    return pageIds.has(requested) ? requested : null;
  })();
  const effectiveSelectedId = selectedFromUrl ?? sortedPages[0]?.id ?? null;
  const [selectedId, setSelectedId] = useState<string | null>(effectiveSelectedId);
  const selectedPage = useMemo(
    () => graph.pages.find((page) => page.id === selectedId) ?? null,
    [graph.pages, selectedId],
  );

  useEffect(() => {
    setSelectedId((current) => (current === effectiveSelectedId ? current : effectiveSelectedId));
  }, [effectiveSelectedId]);

  const pushSearchParams = useCallback(
    (next: URLSearchParams) => {
      const qs = next.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const updateSelectedId = useCallback(
    (pageId: string | null, nextTab?: DetailTab) => {
      setSelectedId(pageId);
      const next = new URLSearchParams(searchParams.toString());
      if (pageId) next.set('node', pageId);
      else next.delete('node');
      next.delete('page');
      if (nextTab) next.set('tab', nextTab);
      pushSearchParams(next);
    },
    [pushSearchParams, searchParams],
  );

  const updateTab = useCallback(
    (tab: DetailTab) => {
      const next = new URLSearchParams(searchParams.toString());
      next.set('tab', tab);
      pushSearchParams(next);
    },
    [pushSearchParams, searchParams],
  );
  // ReactFlow v12 の MiniMap は viewport サイズに応じて SVG の shapeRendering
  // 属性を SSR と CSR で変える (`crispEdges` ↔ `geometricPrecision`) ため、
  // Next.js App Router の 'use client' コンポーネントでも SSR pass で
  // hydration mismatch が出る (#183)。 client mount 後だけ描画する。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  // minimap は 22 pages 程度の run でも画面の 1/4 弱を占め、 graph 本体に被る (#166)。
  // default off + toggle で「観察」 と「俯瞰」 を分離する。 m キーでも toggle 可。
  const [minimapVisible, setMinimapVisible] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (event.key === '/') {
        event.preventDefault();
        document.querySelector<HTMLInputElement>('[data-inspector-filter="true"]')?.focus();
        return;
      }
      if (event.key === 'j' || event.key === 'k') {
        if (sortedPages.length === 0) return;
        event.preventDefault();
        const currentIdx = Math.max(
          0,
          selectedId ? sortedPages.findIndex((page) => page.id === selectedId) : 0,
        );
        const delta = event.key === 'j' ? 1 : -1;
        const nextIdx = (currentIdx + delta + sortedPages.length) % sortedPages.length;
        const nextPage = sortedPages[nextIdx];
        if (nextPage) updateSelectedId(nextPage.id);
        return;
      }
      if (/^[1-6]$/.test(event.key)) {
        const tab = DETAIL_TABS[Number(event.key) - 1];
        if (!tab) return;
        event.preventDefault();
        updateTab(tab);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId, sortedPages, updateSelectedId, updateTab]);

  const nodes = useMemo<Node[]>(() => {
    const positions = layout(graph.pages);
    // 全 pages 単位で title 重複を見て unique を保つ表示 label を一括計算 (#174)。
    const labels = computePageLabels(graph.pages);
    return graph.pages.map((p) => ({
      id: p.id,
      type: 'page',
      position: positions[p.id] ?? { x: 0, y: 0 },
      data: {
        page: p,
        selected: p.id === selectedId,
        displayLabel: labels.get(p.id),
      },
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
        style: {
          stroke: e.kind === 'state' ? '#f3b34c' : '#7c9cff',
          strokeDasharray: e.kind === 'state' ? '5 5' : undefined,
        },
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

  const isFailed = run.status === 'failed' || run.status === 'canceled';

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      {isFailed && (
        <div role="alert" className="border-b border-bad/40 bg-bad/10 px-4 py-2 text-xs text-bad">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-medium uppercase tracking-wider">
              この run は {run.status} 状態で終了しました
            </div>
            {run.errorMessage && <CopyErrorButton message={run.errorMessage} />}
          </div>
          {run.errorMessage ? (
            <pre className="mt-1.5 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded border border-bad/30 bg-bg-panel/60 p-2 font-mono text-[11px] leading-relaxed">
              {run.errorMessage}
            </pre>
          ) : (
            <div className="mt-1.5 text-ink-muted">
              error message が記録されていません。 runner のログ (<code>make logs</code>)
              を確認してください。
            </div>
          )}
        </div>
      )}
      <header className="sticky top-0 z-20 flex min-h-12 items-center justify-between gap-4 border-b border-line bg-bg-subtle px-4 text-xs">
        <div className="min-w-0">
          <div className="truncate font-medium text-ink">{run.startUrl}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-ink-faint">
            <span>{run.status}</span>
            <span>{graph.pages.length} pages</span>
            <span>{graph.edges.length} edges</span>
            {selectedPage && (
              <span>node {sortedPages.findIndex((p) => p.id === selectedPage.id) + 1}</span>
            )}
          </div>
        </div>
        <nav className="flex shrink-0 items-center gap-3 text-xs" aria-label="run inspector links">
          {errorTotal > 0 && (
            <Link
              href={`/runs/${run.id}/errors`}
              className="text-bad hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-bad"
              title="エラーグループ表示 (Issue #88)"
            >
              {errorTotal} errors
            </Link>
          )}
          <Link
            href={`/runs/${run.id}/diff`}
            className="text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            title="1 つ前の run との差分を表示 (Intent #125)"
          >
            diff
          </Link>
          <Link
            href={`/runs/${run.id}/report`}
            className="text-ink-muted hover:text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
            title="静的レポート (印刷 / PDF 保存) Intent #127"
          >
            report
          </Link>
          {run.harPath ? (
            <a
              href={harDownloadUrl(run.id)}
              download={`run-${run.id}-network.har`}
              className="text-ink-muted hover:text-accent hover:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
              title="HAR (Chrome DevTools / Firefox にインポート可能) Issue #87"
            >
              HAR
            </a>
          ) : (
            <span className="text-ink-faint" title="HAR は記録されていません (旧 run / 失敗 run)">
              HAR
            </span>
          )}
        </nav>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
        <div className="relative min-h-0">
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
            onNodeClick={(_, n) => updateSelectedId(n.id)}
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
            {slowPages.length > 0 && !minimapVisible && (
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
                          onClick={() => updateSelectedId(page.id)}
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
        <PageDetailPanel pageId={selectedId} onSelectPage={updateSelectedId} />
      </div>
      <InspectorTimeline
        pages={sortedPages}
        edges={graph.edges}
        selectedId={selectedId}
        onSelectPage={updateSelectedId}
      />
    </div>
  );
}

function InspectorTimeline({
  pages,
  edges,
  selectedId,
  onSelectPage,
}: {
  pages: PageState[];
  edges: Edge[];
  selectedId: string | null;
  onSelectPage: (pageId: string, tab?: DetailTab) => void;
}) {
  const firstMs = pages.length > 0 ? Date.parse(pages[0]!.visitedAt) : 0;
  const lastMs =
    pages.length > 0 ? Math.max(...pages.map((page) => Date.parse(page.visitedAt))) : firstMs;
  const spanMs = Math.max(1, lastMs - firstMs);
  const outgoingByPage = useMemo(() => {
    const map = new Map<string, Edge[]>();
    for (const edge of edges) {
      const current = map.get(edge.fromPageStateId) ?? [];
      current.push(edge);
      map.set(edge.fromPageStateId, current);
    }
    return map;
  }, [edges]);

  return (
    <div className="border-t border-line bg-bg-subtle px-4 py-2 text-[10px]">
      <div className="relative h-16 overflow-x-auto overflow-y-hidden">
        <div className="relative h-full min-w-[720px]">
          {pages.map((page, idx) => {
            const left = ((Date.parse(page.visitedAt) - firstMs) / spanMs) * 92;
            const totalErrors = page.errorCount + page.consoleErrorCount + page.networkErrorCount;
            const edgeKinds = outgoingByPage.get(page.id)?.map((edge) => edge.kind) ?? [];
            const nextTab: DetailTab =
              totalErrors > 0
                ? 'errors'
                : page.consoleErrorCount > 0
                  ? 'console'
                  : page.networkErrorCount > 0
                    ? 'network'
                    : 'screen';
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => onSelectPage(page.id, nextTab)}
                className={cn(
                  'absolute top-5 h-8 min-w-24 rounded border px-2 text-left transition-colors',
                  selectedId === page.id
                    ? 'border-accent bg-accent/15 text-accent'
                    : totalErrors > 0
                      ? 'border-bad/40 bg-bad/10 text-bad hover:border-bad'
                      : 'border-line bg-bg-panel text-ink-muted hover:border-accent-soft hover:text-ink',
                )}
                style={{ left: `${left}%` }}
                title={page.url}
              >
                <span className="block truncate font-mono">#{idx + 1}</span>
                <span className="block truncate">{page.title || page.url}</span>
                {edgeKinds.length > 0 && (
                  <span className="absolute -top-4 left-1 flex gap-1 text-[9px] uppercase tracking-wider">
                    {Array.from(new Set(edgeKinds)).map((kind) => (
                      <span
                        key={kind}
                        className={cn(
                          'rounded px-1',
                          kind === 'state' ? 'bg-warn/15 text-warn' : 'bg-accent/15 text-accent',
                        )}
                      >
                        {kind}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
          <div className="pointer-events-none absolute left-0 right-0 top-[2.15rem] border-t border-line" />
        </div>
      </div>
    </div>
  );
}

function CopyErrorButton({ message }: { message: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(message).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded border border-bad/40 bg-bad/15 px-2 py-0.5 text-[10px] uppercase tracking-wider text-bad hover:bg-bad/25 focus-visible:outline focus-visible:outline-1 focus-visible:outline-bad"
      aria-label="errorMessage の全文をコピー"
    >
      {copied ? 'copied' : 'copy'}
    </button>
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
