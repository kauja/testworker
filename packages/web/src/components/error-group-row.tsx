'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ErrorGroup } from '@testworker/shared';
import { cn } from '@/lib/cn';

export function ErrorGroupRow({ group }: { group: ErrorGroup }) {
  const [open, setOpen] = useState(false);
  const isHigh = group.count >= 5;
  return (
    <li>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-bg-panel/60"
        aria-expanded={open}
      >
        <span
          className={cn(
            'mt-0.5 inline-flex min-w-[3rem] justify-center rounded px-2 py-0.5 text-[11px] font-mono',
            isHigh ? 'bg-bad/15 text-bad' : 'bg-accent/10 text-accent',
          )}
          title="このグループのエラー総数"
        >
          ×{group.count}
        </span>
        <span className="flex-1 overflow-hidden">
          <span className="flex items-center gap-2 text-[11px] text-ink-faint">
            <span className="rounded bg-bad/15 px-1.5 py-0.5 text-bad">{group.kind}</span>
            <span>{group.samplePages.length} pages affected</span>
            <span className="font-mono">{group.fingerprint}</span>
          </span>
          <span className="mt-1 block break-words font-mono text-[12px] text-ink">
            {group.message}
          </span>
        </span>
        <span aria-hidden className="mt-0.5 text-ink-faint">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open && (
        <div className="border-t border-line bg-bg-panel/50 px-4 py-3 text-xs">
          {group.stack && (
            <pre className="mb-3 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle p-2 font-mono text-[11px] text-ink-muted">
              {group.stack}
            </pre>
          )}
          <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">
            sample pages ({group.samplePages.length})
          </div>
          <ul className="space-y-1">
            {group.samplePages.map((p) => (
              <li key={p.pageStateId}>
                <Link
                  href={`/runs/${p.pageStateId.split(':')[0] ?? ''}/`}
                  className="block truncate font-mono text-[11px] text-accent hover:underline"
                  title={p.url}
                >
                  {p.title || '(untitled)'} — {p.url}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
