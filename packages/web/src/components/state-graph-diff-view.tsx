'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type {
  StateGraphDiffEdge,
  StateGraphDiffScreen,
  StateGraphDiffState,
} from '@testworker/shared';
import { cn } from '@/lib/cn';

export function StateGraphDiffView({ screens }: { screens: StateGraphDiffScreen[] }) {
  const [selected, setSelected] = useState<StateGraphDiffScreen | null>(null);

  if (screens.length === 0) {
    return (
      <div className="rounded border border-line bg-bg-subtle px-4 py-10 text-center text-sm text-ink-muted">
        状態遷移グラフの差分はありません。
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        {screens.map((screen) => (
          <button
            key={screen.navHash}
            type="button"
            onClick={() => setSelected(screen)}
            className="rounded border border-line bg-bg-subtle p-3 text-left hover:border-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">
                  {screen.title || '(untitled)'}
                </div>
                <div className="truncate font-mono text-[11px] text-ink-muted">{screen.url}</div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-1 text-[10px]">
                <Pill tone="accent">+{screen.addedStates.length} state</Pill>
                <Pill tone="bad">-{screen.removedStates.length} state</Pill>
                <Pill tone="accent">+{screen.addedEdges.length} edge</Pill>
                <Pill tone="bad">-{screen.removedEdges.length} edge</Pill>
                {screen.changedTriggers.length > 0 && (
                  <Pill tone="warn">{screen.changedTriggers.length} trigger</Pill>
                )}
                {screen.flaky && (
                  <Pill tone="warn">
                    flaky {screen.stabilityScore == null ? '' : screen.stabilityScore.toFixed(2)}
                  </Pill>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
      {selected && <StateDiffModal screen={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

function StateDiffModal({
  screen,
  onClose,
}: {
  screen: StateGraphDiffScreen;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
      <div className="grid h-[78dvh] w-full max-w-6xl grid-rows-[auto_1fr] rounded border border-line bg-bg-panel shadow-xl">
        <header className="flex items-start justify-between gap-4 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="text-sm font-medium text-ink">{screen.title || '(untitled)'}</div>
            <div className="truncate font-mono text-[11px] text-ink-muted">{screen.url}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-accent hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent"
          >
            close
          </button>
        </header>
        <div className="grid min-h-0 grid-cols-2 gap-3 p-3">
          <MiniGraph
            title="base"
            tone="bad"
            states={screen.removedStates}
            edges={screen.removedEdges}
            triggerChanges={screen.changedTriggers.map((change) => ({
              id: `base-${change.fromStructureHash}-${change.toStructureHash}`,
              fromStructureHash: change.fromStructureHash,
              toStructureHash: change.toStructureHash,
              trigger: change.baseTrigger,
              triggerSelector: change.baseSelector,
            }))}
          />
          <MiniGraph
            title="target"
            tone="accent"
            states={screen.addedStates}
            edges={screen.addedEdges}
            triggerChanges={screen.changedTriggers.map((change) => ({
              id: `target-${change.fromStructureHash}-${change.toStructureHash}`,
              fromStructureHash: change.fromStructureHash,
              toStructureHash: change.toStructureHash,
              trigger: change.targetTrigger,
              triggerSelector: change.targetSelector,
            }))}
          />
        </div>
      </div>
    </div>
  );
}

function MiniGraph({
  title,
  tone,
  states,
  edges,
  triggerChanges,
}: {
  title: string;
  tone: 'accent' | 'bad';
  states: StateGraphDiffState[];
  edges: StateGraphDiffEdge[];
  triggerChanges: StateGraphDiffEdge[];
}) {
  const graph = useMemo(() => {
    const hashes = new Set<string>();
    for (const state of states) hashes.add(state.structureHash);
    for (const edge of [...edges, ...triggerChanges]) {
      hashes.add(edge.fromStructureHash);
      hashes.add(edge.toStructureHash);
    }
    const ordered = [...hashes].sort();
    const nodes: Node[] = ordered.map((hash, index) => ({
      id: hash,
      position: { x: (index % 3) * 190, y: Math.floor(index / 3) * 96 },
      data: { label: hash.slice(0, 10) },
      style: {
        width: 150,
        border: `1px solid ${tone === 'accent' ? '#6ee7b7' : '#f87171'}`,
        background: '#15191f',
        color: '#d7dde7',
        fontSize: 11,
      },
    }));
    const flowEdges: Edge[] = [...edges, ...triggerChanges].map((edge, index) => ({
      id: `${edge.id}-${index}`,
      source: edge.fromStructureHash,
      target: edge.toStructureHash,
      label: edge.trigger,
      animated: triggerChanges.includes(edge),
      style: { stroke: tone === 'accent' ? '#6ee7b7' : '#f87171' },
      labelStyle: { fontSize: 10, fill: '#8d96a3' },
      labelBgStyle: { fill: '#15191f' },
    }));
    return { nodes, edges: flowEdges };
  }, [edges, states, tone, triggerChanges]);

  return (
    <section className="grid min-h-0 grid-rows-[auto_1fr] overflow-hidden rounded border border-line">
      <header
        className={cn(
          'border-b border-line px-3 py-2 text-xs font-medium uppercase tracking-wider',
          tone === 'accent' ? 'text-accent' : 'text-bad',
        )}
      >
        {title}
      </header>
      <ReactFlow
        nodes={graph.nodes}
        edges={graph.edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.2}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#1c222b" />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          nodeColor={tone === 'accent' ? '#2d5f50' : '#6c3434'}
          maskColor="rgba(11,13,16,0.7)"
          position="top-right"
          style={{ width: 120, height: 80 }}
        />
      </ReactFlow>
    </section>
  );
}

function Pill({ tone, children }: { tone: 'accent' | 'bad' | 'warn'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-mono',
        tone === 'accent'
          ? 'bg-accent/15 text-accent'
          : tone === 'bad'
            ? 'bg-bad/15 text-bad'
            : 'bg-warn/15 text-warn',
      )}
    >
      {children}
    </span>
  );
}
