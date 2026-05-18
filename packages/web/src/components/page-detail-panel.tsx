'use client';

import { useEffect, useState } from 'react';
import type { PageDetail } from '@testworker/shared';
import { assetUrl, fetchPage } from '@/lib/api';
import { cn } from '@/lib/cn';

type Tab = 'overview' | 'console' | 'network' | 'errors';

export function PageDetailPanel({ pageId }: { pageId: string | null }) {
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    if (!pageId) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetchPage(pageId)
      .then((d) => setDetail(d))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [pageId]);

  if (!pageId) {
    return (
      <aside className="border-l border-line bg-bg-subtle p-6 text-sm text-ink-muted">
        ノードを選択するとログ・ネットワーク・エラーを表示します。
      </aside>
    );
  }

  if (loading || !detail) {
    return (
      <aside className="border-l border-line bg-bg-subtle p-6 text-sm text-ink-muted">
        loading…
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col border-l border-line bg-bg-subtle">
      <div className="border-b border-line p-4">
        <div className="truncate text-sm font-medium text-ink">
          {detail.page.title || '(untitled)'}
        </div>
        <div className="mt-1 truncate text-xs text-ink-muted">{detail.page.url}</div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <Counter
            label="page errors"
            value={detail.errors.length}
            tone={detail.errors.length ? 'bad' : 'mute'}
          />
          <Counter
            label="console errors"
            value={detail.console.filter((c) => c.level === 'error').length}
            tone={detail.console.some((c) => c.level === 'error') ? 'bad' : 'mute'}
          />
          <Counter
            label="net failures"
            value={detail.network.filter((n) => n.failed || (n.status ?? 0) >= 400).length}
            tone={detail.network.some((n) => n.failed || (n.status ?? 0) >= 400) ? 'bad' : 'mute'}
          />
        </div>
      </div>

      <div className="flex gap-1 border-b border-line px-2 pt-2 text-xs">
        {(['overview', 'console', 'network', 'errors'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-t px-3 py-1.5 capitalize transition-colors',
              tab === t
                ? 'bg-bg-panel text-ink'
                : 'text-ink-muted hover:bg-bg-panel/60 hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'overview' && (
          <div className="p-4">
            {detail.page.screenshotPath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={assetUrl(detail.page.screenshotPath)}
                alt={detail.page.title}
                className="w-full rounded border border-line"
              />
            ) : (
              <div className="text-xs text-ink-muted">no screenshot</div>
            )}
          </div>
        )}
        {tab === 'console' && (
          <ul className="divide-y divide-line text-xs">
            {detail.console.map((c) => (
              <li key={c.id} className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <LevelTag level={c.level} />
                  <span className="text-ink-faint">
                    {new Date(c.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="mt-1 break-words font-mono text-[12px] text-ink">{c.text}</div>
                {c.url && (
                  <div className="mt-0.5 truncate text-[11px] text-ink-faint">
                    {c.url}
                    {c.lineNumber ? `:${c.lineNumber}` : ''}
                  </div>
                )}
              </li>
            ))}
            {detail.console.length === 0 && <li className="p-4 text-ink-muted">なし</li>}
          </ul>
        )}
        {tab === 'network' && (
          <table className="w-full text-[11px]">
            <thead className="sticky top-0 bg-bg-subtle text-left text-ink-faint">
              <tr>
                <th className="px-3 py-2 font-normal">Method</th>
                <th className="px-3 py-2 font-normal">URL</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {detail.network.map((n) => {
                const bad = n.failed || (n.status ?? 0) >= 400;
                return (
                  <tr key={n.id} className={cn(bad ? 'text-bad' : 'text-ink')}>
                    <td className="px-3 py-1.5 font-mono">{n.method}</td>
                    <td className="px-3 py-1.5 font-mono">
                      <span className="block max-w-[260px] truncate">{n.url}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono">
                      {n.status ?? (n.failed ? 'FAIL' : '')}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted">{n.resourceType}</td>
                    <td className="px-3 py-1.5 text-ink-muted">{n.durationMs ?? ''} ms</td>
                  </tr>
                );
              })}
              {detail.network.length === 0 && (
                <tr>
                  <td className="p-4 text-ink-muted" colSpan={5}>
                    なし
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
        {tab === 'errors' && (
          <ul className="divide-y divide-line text-xs">
            {detail.errors.map((e) => (
              <li key={e.id} className="px-4 py-2">
                <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                  <span className="rounded bg-bad/15 px-1.5 py-0.5 text-bad">{e.kind}</span>
                  <span>{new Date(e.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="mt-1 font-mono text-[12px] text-ink">{e.message}</div>
                {e.stack && (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-panel p-2 font-mono text-[11px] text-ink-muted">
                    {e.stack}
                  </pre>
                )}
              </li>
            ))}
            {detail.errors.length === 0 && <li className="p-4 text-ink-muted">なし</li>}
          </ul>
        )}
      </div>
    </aside>
  );
}

function LevelTag({ level }: { level: string }) {
  const map: Record<string, string> = {
    error: 'bg-bad/15 text-bad',
    warn: 'bg-warn/15 text-warn',
    info: 'bg-accent/15 text-accent',
    debug: 'bg-ink/10 text-ink-muted',
    log: 'bg-ink/10 text-ink-muted',
  };
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
        map[level] ?? map.log,
      )}
    >
      {level}
    </span>
  );
}

function Counter({ label, value, tone }: { label: string; value: number; tone: 'bad' | 'mute' }) {
  return (
    <div className="rounded bg-bg-panel px-2 py-1.5">
      <div className={cn('font-mono text-sm', tone === 'bad' ? 'text-bad' : 'text-ink')}>
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</div>
    </div>
  );
}
