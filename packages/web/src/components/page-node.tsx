'use client';

import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import type { PageState } from '@testworker/shared';
import { assetUrl } from '@/lib/api';
import { cn } from '@/lib/cn';

export type PageNodeData = {
  page: PageState;
  selected: boolean;
  /** 表示用 label (#174)。 未指定なら page.title → URL fallback。 */
  displayLabel?: string;
};
export type PageNodeType = Node<PageNodeData, 'page'>;

export function PageNode({ data }: NodeProps<PageNodeType>) {
  const { page, selected, displayLabel } = data;
  const label = displayLabel ?? page.title ?? '(untitled)';
  const hasError = page.errorCount + page.consoleErrorCount + page.networkErrorCount > 0;
  return (
    <div
      className={cn(
        'group relative w-[220px] overflow-hidden rounded-lg border bg-bg-panel text-left shadow-sm transition-all',
        selected
          ? 'border-accent shadow-[0_0_0_2px_rgba(124,156,255,0.25)]'
          : hasError
            ? 'border-bad/40 hover:border-bad'
            : 'border-line hover:border-accent-soft',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !bg-line" />
      <div className="relative aspect-[16/9] w-full bg-bg-subtle">
        {page.screenshotPath ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assetUrl(page.screenshotPath)}
            alt={page.title}
            className="size-full object-cover object-top opacity-90 transition-opacity group-hover:opacity-100"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-ink-faint">
            no preview
          </div>
        )}
        {hasError && (
          <div className="absolute right-1.5 top-1.5 rounded bg-bad/90 px-1.5 py-0.5 font-mono text-[10px] text-bg">
            {page.errorCount + page.consoleErrorCount + page.networkErrorCount}
          </div>
        )}
        {page.flaky && (
          <div className="absolute left-1.5 top-1.5 rounded bg-warn/90 px-1.5 py-0.5 font-mono text-[10px] text-bg">
            flaky {page.stabilityScore == null ? '' : page.stabilityScore.toFixed(2)}
          </div>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="truncate text-[12px] font-medium text-ink" title={page.title}>
          {label}
        </div>
        <div className="truncate text-[11px] text-ink-faint">{page.url}</div>
      </div>
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !bg-line" />
    </div>
  );
}
