import type { RunStoppedReason } from '@testworker/shared';
import { cn } from '@/lib/cn';

const LABELS: Record<RunStoppedReason, string> = {
  max_depth: 'Max depth',
  max_pages: 'Max pages',
  max_duration: 'Max duration',
  max_errors: 'Max errors',
  max_network_fails: 'Network fails',
  stable_plateau: 'Stable plateau',
  reached_url: 'Reached URL',
  reached_selector: 'Reached selector',
  max_screenshots: 'Max screenshots',
  manual_cancel: 'Manual cancel',
  crashed: 'Crashed',
};

export function StopReasonBadge({
  reason,
  compact = false,
}: {
  reason: RunStoppedReason | null;
  compact?: boolean;
}) {
  if (!reason) return null;
  const tone =
    reason === 'crashed'
      ? 'border-bad/30 bg-bad/10 text-bad'
      : 'border-accent-soft bg-accent/10 text-accent';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        compact ? 'px-2 py-0.5 text-[11px] uppercase tracking-wider' : 'px-2.5 py-1 text-xs',
        tone,
      )}
    >
      Stop: {LABELS[reason]}
    </span>
  );
}
