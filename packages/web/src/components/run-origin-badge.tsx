import type { RunOrigin } from '@testworker/shared';
import { cn } from '@/lib/cn';

export function RunOriginBadge({
  origin,
  compact = false,
}: {
  origin: RunOrigin;
  compact?: boolean;
}) {
  const tone =
    origin === 'scheduled'
      ? 'border-accent-soft bg-accent/10 text-accent'
      : 'border-line bg-ink/5 text-ink-muted';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        compact ? 'px-2 py-0.5 text-[11px] uppercase tracking-wider' : 'px-2.5 py-1 text-xs',
        tone,
      )}
    >
      {origin}
    </span>
  );
}
