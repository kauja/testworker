import type { Run } from '@testworker/shared';
import { cn } from '@/lib/cn';

/**
 * 走行中の run の進捗バー + 現在処理中 URL を 1 ブロックで表示する (Issue #86)。
 * 完了済み / queued / failed 等は描画しない (上位で条件分岐)。
 */
export function RunProgress({ run, compact = false }: { run: Run; compact?: boolean }) {
  const total = run.options.maxPages;
  // 旧 run / failed 後の最終 snapshot 等で pagesDone が total を上回る可能性が
  // 数学的にはあるので clamp する。
  const done = Math.max(0, Math.min(run.pagesDone, total));
  const pct = total > 0 ? (done / total) * 100 : 0;
  return (
    <div className={cn('space-y-1', compact ? 'text-[11px]' : 'text-xs')}>
      <div className="flex items-center justify-between gap-2 text-ink-muted">
        <span className="font-mono">
          {done}
          <span className="text-ink-faint"> / {total}</span>
          <span className="ml-1 text-ink-faint">pages</span>
          {run.queueSize !== null && run.queueSize > 0 && (
            <span className="ml-2 text-ink-faint">queue {run.queueSize}</span>
          )}
        </span>
        <span className="font-mono tabular-nums text-ink-faint">{pct.toFixed(0)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-bg-panel">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {run.currentUrl && (
        <div className="truncate font-mono text-[11px] text-ink-faint" title={run.currentUrl}>
          → {run.currentUrl}
        </div>
      )}
    </div>
  );
}
