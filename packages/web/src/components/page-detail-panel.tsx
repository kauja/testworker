'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type {
  ConsoleEntry,
  Edge,
  ErrorContext,
  NetworkEntry,
  PageDetail,
  PageError,
  PageMetrics,
} from '@testworker/shared';
import { assetUrl, fetchErrorContext, fetchPage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { TimeStamp } from './time-stamp';

export const DETAIL_TABS = ['screen', 'console', 'network', 'errors', 'routes', 'vitals'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];
type Tab = DetailTab;
type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';
type NetStatusBucket = '2xx' | '3xx' | '4xx' | '5xx' | 'failed';

const CONSOLE_LEVELS: readonly ConsoleLevel[] = ['log', 'info', 'warn', 'error', 'debug'] as const;
const NET_STATUS_BUCKETS: readonly NetStatusBucket[] = [
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  'failed',
] as const;

export function PageDetailPanel({
  pageId,
  onSelectPage,
}: {
  pageId: string | null;
  /** routes タブで edge クリック時に呼ぶ。 graph 側で同じ node を選択し、 React Flow を再フォーカスする想定。 */
  onSelectPage?: (id: string) => void;
}) {
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [tabParam, setTabParam] = useQueryParamState('tab', 'screen', { history: 'push' });
  const normalizedTabParam = tabParam === 'overview' ? 'screen' : tabParam;
  const tab = isDetailTab(normalizedTabParam) ? normalizedTabParam : 'screen';
  const setTab = (next: Tab) => setTabParam(next);

  useEffect(() => {
    if (!pageId) {
      setDetail(null);
      // 進行中の fetch を cleanup の abort で潰したまま pageId=null になると、
      // finally の setLoading(false) が aborted ガードでスキップされ loading が
      // stuck する。早期 return でも明示的にクリアする。
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    fetchPage(pageId, { signal: ctrl.signal })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        setDetail(d);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (ctrl.signal.aborted) return;
        setDetail(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
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

      <div
        role="tablist"
        aria-label="page detail tabs"
        onKeyDown={(e) => {
          // 左右矢印 / Home / End で tab を移動する (Issue #106 / a11y)。
          // 矢印キーは roving tabindex 的に focus も次タブに移す。
          const idx = DETAIL_TABS.indexOf(tab);
          let nextIdx: number | null = null;
          if (e.key === 'ArrowRight') nextIdx = (idx + 1) % DETAIL_TABS.length;
          else if (e.key === 'ArrowLeft')
            nextIdx = (idx - 1 + DETAIL_TABS.length) % DETAIL_TABS.length;
          else if (e.key === 'Home') nextIdx = 0;
          else if (e.key === 'End') nextIdx = DETAIL_TABS.length - 1;
          if (nextIdx == null) return;
          e.preventDefault();
          const next = DETAIL_TABS[nextIdx];
          if (!next) return;
          setTab(next);
          const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`);
          el?.focus();
        }}
        className="flex gap-1 border-b border-line px-2 pt-2 text-xs"
      >
        {DETAIL_TABS.map((t) => {
          const count =
            t === 'routes'
              ? detail.incoming.length + detail.outgoing.length
              : t === 'console'
                ? detail.console.length
                : t === 'network'
                  ? detail.network.length
                  : t === 'errors'
                    ? detail.errors.length
                    : null;
          return (
            <button
              key={t}
              role="tab"
              data-tab={t}
              id={`tab-${t}`}
              aria-controls={`tabpanel-${t}`}
              aria-selected={tab === t}
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={cn(
                'rounded-t px-3 py-1.5 capitalize transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
                tab === t
                  ? 'bg-bg-panel text-ink'
                  : 'text-ink-muted hover:bg-bg-panel/60 hover:text-ink',
              )}
            >
              {tabLabel(t)}
              {count != null && count > 0 && <span className="ml-1 text-ink-faint">({count})</span>}
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-auto">
        <div
          role="tabpanel"
          id="tabpanel-screen"
          aria-labelledby="tab-screen"
          hidden={tab !== 'screen'}
        >
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
        </div>
        <div
          role="tabpanel"
          id="tabpanel-routes"
          aria-labelledby="tab-routes"
          hidden={tab !== 'routes'}
        >
          {tab === 'routes' && (
            <RoutesTab
              incoming={detail.incoming}
              outgoing={detail.outgoing}
              onSelectPage={onSelectPage}
            />
          )}
        </div>
        <div
          role="tabpanel"
          id="tabpanel-console"
          aria-labelledby="tab-console"
          hidden={tab !== 'console'}
        >
          {tab === 'console' && <ConsoleTab entries={detail.console} />}
        </div>
        <div
          role="tabpanel"
          id="tabpanel-network"
          aria-labelledby="tab-network"
          hidden={tab !== 'network'}
        >
          {tab === 'network' && <NetworkTab entries={detail.network} />}
        </div>
        <div
          role="tabpanel"
          id="tabpanel-errors"
          aria-labelledby="tab-errors"
          hidden={tab !== 'errors'}
        >
          <ul className="divide-y divide-line text-xs">
            {detail.errors.map((e) => (
              <li key={e.id} className="px-4 py-3">
                <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                  <span className="rounded bg-bad/15 px-1.5 py-0.5 text-bad">{e.kind}</span>
                  <TimeStamp value={e.timestamp} options={{ timeStyle: 'medium' }} />
                </div>
                <div className="mt-1 font-mono text-[12px] text-ink">{e.message}</div>
                {e.stack && (
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-panel p-2 font-mono text-[11px] text-ink-muted">
                    {e.stack}
                  </pre>
                )}
                <RootCauseKit error={e} />
              </li>
            ))}
            {detail.errors.length === 0 && <li className="p-4 text-ink-muted">なし</li>}
          </ul>
        </div>
        <div
          role="tabpanel"
          id="tabpanel-vitals"
          aria-labelledby="tab-vitals"
          hidden={tab !== 'vitals'}
        >
          <div className="p-4">
            <PerformanceSection metrics={detail.page.metrics} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function RootCauseKit({ error }: { error: PageError }) {
  const [context, setContext] = useState<ErrorContext | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [missing, setMissing] = useState(false);

  const load = async () => {
    if (context || loading || missing) {
      setOpen((v) => !v);
      return;
    }
    setOpen(true);
    setLoading(true);
    try {
      setContext(await fetchErrorContext(error.id));
    } catch {
      setMissing(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-2 rounded border border-line bg-bg-panel/60">
      <button
        type="button"
        onClick={load}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[11px] uppercase tracking-wider text-ink-faint hover:text-ink"
      >
        Root cause kit
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {loading && <div className="text-xs text-ink-muted">loading…</div>}
          {missing && !loading && (
            <div className="text-xs text-ink-muted">context はまだ保存されていません。</div>
          )}
          {context && <RootCauseContext context={context} />}
        </div>
      )}
    </div>
  );
}

function RootCauseContext({ context }: { context: ErrorContext }) {
  return (
    <div className="space-y-3 text-xs">
      <section>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">
          Symbolicated stack
        </div>
        {context.symbolicatedStack.length > 0 ? (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-bg-subtle p-2 font-mono text-[11px] text-ink-muted">
            {context.symbolicatedStack.map((frame) => frame.raw).join('\n')}
          </pre>
        ) : (
          <div className="text-ink-muted">stack なし</div>
        )}
      </section>
      <ContextList
        title="Last interactions"
        empty="interaction なし"
        items={context.recentInteractions.map((item) => ({
          key: `${item.timestamp}-${item.kind}-${item.selector ?? ''}`,
          meta: `${item.deltaMs}ms ${item.kind}`,
          body: [item.selector, item.text, item.value, item.key].filter(Boolean).join(' · '),
        }))}
      />
      <ContextList
        title="Last network"
        empty="network なし"
        items={context.recentNetwork.map((item) => ({
          key: item.id,
          meta: `${item.deltaMs}ms ${item.method} ${item.status ?? (item.failed ? 'failed' : 'n/a')}`,
          body: item.url,
          tone: item.failed || (item.status ?? 0) >= 400 ? 'bad' : undefined,
        }))}
      />
      <ContextList
        title="Last console"
        empty="console なし"
        items={context.recentConsole.map((item) => ({
          key: item.id,
          meta: `${item.deltaMs}ms ${item.level}`,
          body: item.text,
          tone: item.level === 'error' ? 'bad' : undefined,
        }))}
      />
      <section className="grid grid-cols-2 gap-2">
        <AssetLink label="DOM snapshot" relPath={context.domSnapshotRef} />
        <AssetLink label="Screenshot" relPath={context.screenshotRef} />
      </section>
      <section className="rounded border border-line bg-bg-subtle px-2 py-2 font-mono text-[10px] text-ink-muted">
        {context.env.url}
        <br />
        {context.env.viewport.width}x{context.env.viewport.height} · DPR{' '}
        {context.env.devicePixelRatio} · {context.env.timezone}
      </section>
      {context.storage && (
        <section className="rounded border border-warn/40 bg-warn/10 px-2 py-2 text-[10px] text-warn">
          storage snapshot: local {Object.keys(context.storage.localStorage).length} / session{' '}
          {Object.keys(context.storage.sessionStorage).length} / cookies{' '}
          {context.storage.cookies.length}
        </section>
      )}
    </div>
  );
}

function ContextList({
  title,
  empty,
  items,
}: {
  title: string;
  empty: string;
  items: Array<{ key: string; meta: string; body: string; tone?: 'bad' }>;
}) {
  return (
    <section>
      <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">{title}</div>
      {items.length === 0 ? (
        <div className="text-ink-muted">{empty}</div>
      ) : (
        <ul className="space-y-1">
          {items.map((item) => (
            <li key={item.key} className="rounded border border-line bg-bg-subtle px-2 py-1.5">
              <div
                className={cn(
                  'font-mono text-[10px]',
                  item.tone === 'bad' ? 'text-bad' : 'text-ink-faint',
                )}
              >
                {item.meta}
              </div>
              <div className="mt-0.5 break-words font-mono text-[11px] text-ink-muted">
                {item.body || '(empty)'}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AssetLink({ label, relPath }: { label: string; relPath: string | null }) {
  if (!relPath) {
    return (
      <div className="rounded border border-line bg-bg-subtle px-2 py-2 text-center text-[11px] text-ink-muted">
        {label}: none
      </div>
    );
  }
  return (
    <a
      href={assetUrl(relPath)}
      target="_blank"
      rel="noreferrer"
      className="rounded border border-line bg-bg-subtle px-2 py-2 text-center text-[11px] text-accent hover:border-accent"
    >
      {label}
    </a>
  );
}

function isDetailTab(value: string): value is Tab {
  return DETAIL_TABS.includes(value as Tab);
}

function tabLabel(tab: Tab): string {
  switch (tab) {
    case 'screen':
      return 'Screen';
    case 'console':
      return 'Console';
    case 'network':
      return 'Network';
    case 'errors':
      return 'Errors';
    case 'routes':
      return 'Routes';
    case 'vitals':
      return 'Vitals';
  }
}

type MetricKey = 'lcp' | 'cls' | 'inp' | 'ttfb' | 'fcp';
type MetricTone = 'good' | 'needs-improvement' | 'poor' | 'missing';

const METRICS: Array<{
  key: MetricKey;
  label: string;
  unit: 'ms' | '';
  thresholds: [number, number];
}> = [
  { key: 'lcp', label: 'LCP', unit: 'ms', thresholds: [2500, 4000] },
  { key: 'cls', label: 'CLS', unit: '', thresholds: [0.1, 0.25] },
  { key: 'inp', label: 'INP', unit: 'ms', thresholds: [200, 500] },
  { key: 'ttfb', label: 'TTFB', unit: 'ms', thresholds: [800, 1800] },
  { key: 'fcp', label: 'FCP', unit: 'ms', thresholds: [1800, 3000] },
];

function PerformanceSection({ metrics }: { metrics: PageMetrics }) {
  const hasMetrics = METRICS.some((m) => typeof metrics[m.key] === 'number');
  return (
    <section className="mt-4 rounded border border-line bg-bg-panel p-3 text-xs">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[10px] uppercase tracking-wider text-ink-faint">Performance</h3>
        <span className="text-[10px] text-ink-faint">Web Vitals</span>
      </div>
      {hasMetrics ? (
        <div className="grid grid-cols-2 gap-2">
          {METRICS.map((m) => {
            const value = metrics[m.key];
            const tone = metricTone(value, m.thresholds);
            return (
              <div key={m.key} className="rounded border border-line bg-bg-subtle px-2 py-1.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10px] uppercase tracking-wider text-ink-faint">
                    {m.label}
                  </span>
                  <span className={cn('font-mono text-sm', metricToneClass(tone))}>
                    {formatMetric(value, m.unit)}
                  </span>
                </div>
                <div className={cn('mt-1 text-[10px]', metricToneClass(tone))}>
                  {metricLabel(tone)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-ink-muted">not captured</p>
      )}
    </section>
  );
}

function metricTone(value: number | null | undefined, [good, poor]: [number, number]): MetricTone {
  if (typeof value !== 'number') return 'missing';
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

function metricToneClass(tone: MetricTone): string {
  switch (tone) {
    case 'good':
      return 'text-ok';
    case 'needs-improvement':
      return 'text-warn';
    case 'poor':
      return 'text-bad';
    case 'missing':
      return 'text-ink-faint';
  }
}

function metricLabel(tone: MetricTone): string {
  switch (tone) {
    case 'good':
      return 'Good';
    case 'needs-improvement':
      return 'NI';
    case 'poor':
      return 'Poor';
    case 'missing':
      return 'n/a';
  }
}

function formatMetric(value: number | null | undefined, unit: 'ms' | ''): string {
  if (typeof value !== 'number') return 'n/a';
  if (unit === 'ms') return `${Math.round(value)} ms`;
  return value.toFixed(3);
}

function RoutesTab({
  incoming,
  outgoing,
  onSelectPage,
}: {
  incoming: Edge[];
  outgoing: Edge[];
  onSelectPage?: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-line text-xs">
      <EdgeSection
        title="Incoming"
        emptyLabel="到達経路なし (start ノード or 孤立)"
        edges={incoming}
        targetField="from"
        onSelectPage={onSelectPage}
      />
      <EdgeSection
        title="Outgoing"
        emptyLabel="このページからの遷移なし"
        edges={outgoing}
        targetField="to"
        onSelectPage={onSelectPage}
      />
    </div>
  );
}

function EdgeSection({
  title,
  emptyLabel,
  edges,
  targetField,
  onSelectPage,
}: {
  title: string;
  emptyLabel: string;
  edges: Edge[];
  /** クリック時にナビゲートする先 ('from' incoming / 'to' outgoing)。 */
  targetField: 'from' | 'to';
  onSelectPage?: (id: string) => void;
}) {
  return (
    <section className="px-3 py-2">
      <h3 className="mb-1 text-[10px] uppercase tracking-wider text-ink-faint">
        {title} ({edges.length})
      </h3>
      {edges.length === 0 ? (
        <p className="px-1 py-1 text-ink-muted">{emptyLabel}</p>
      ) : (
        <ul className="divide-y divide-line">
          {edges.map((e) => {
            const targetId = targetField === 'from' ? e.fromPageStateId : e.toPageStateId;
            return (
              <li key={e.id}>
                <button
                  onClick={() => onSelectPage?.(targetId)}
                  disabled={!onSelectPage}
                  className={cn(
                    'group block w-full px-1 py-1.5 text-left transition-colors',
                    onSelectPage ? 'hover:bg-bg-panel/60' : 'cursor-default',
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] text-ink-faint">
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-accent">
                      {e.trigger}
                    </span>
                    {e.triggerText && (
                      <span className="truncate font-mono text-ink-muted">
                        “{e.triggerText.slice(0, 60)}”
                      </span>
                    )}
                  </div>
                  {e.triggerSelector && (
                    <div className="mt-0.5 truncate font-mono text-[11px] text-ink-faint">
                      {e.triggerSelector}
                    </div>
                  )}
                  <div className="mt-0.5 truncate text-[11px] text-ink group-hover:text-accent">
                    → {targetId}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ConsoleTab({ entries }: { entries: ConsoleEntry[] }) {
  const [q, setQ] = useQueryParamState('q_console', '');
  const [levels, setLevels] = useQueryParamSetState<ConsoleLevel>(
    'lvl_console',
    CONSOLE_LEVELS as readonly string[],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((c) => {
      if (!levels.has(c.level)) return false;
      if (needle && !c.text.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, q, levels]);

  const isFiltered = q !== '' || levels.size !== CONSOLE_LEVELS.length;

  return (
    <>
      <FilterBar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="text を検索 (case-insensitive)"
        chips={CONSOLE_LEVELS.map((lv) => ({
          key: lv,
          label: lv,
          active: levels.has(lv),
          onToggle: () => toggleSet(levels, lv, setLevels, CONSOLE_LEVELS),
        }))}
        showing={filtered.length}
        total={entries.length}
        canReset={isFiltered}
        onReset={() => {
          setQ('');
          setLevels(new Set(CONSOLE_LEVELS));
        }}
      />
      <ul className="divide-y divide-line text-xs">
        {filtered.map((c) => (
          <li key={c.id} className="px-4 py-2">
            <div className="flex items-center gap-2">
              <LevelTag level={c.level} />
              <TimeStamp
                value={c.timestamp}
                options={{ timeStyle: 'medium' }}
                className="text-ink-faint"
              />
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
        {filtered.length === 0 && (
          <li className="p-4 text-ink-muted">
            {entries.length === 0 ? 'なし' : 'フィルタに該当なし'}
          </li>
        )}
      </ul>
    </>
  );
}

function NetworkTab({ entries }: { entries: NetworkEntry[] }) {
  const [q, setQ] = useQueryParamState('q_net', '');
  const [buckets, setBuckets] = useQueryParamSetState<NetStatusBucket>(
    'st_net',
    NET_STATUS_BUCKETS as readonly string[],
  );
  const methods = useMemo(() => {
    const set = new Set<string>();
    for (const n of entries) set.add(n.method);
    return Array.from(set).sort();
  }, [entries]);
  const [activeMethods, setActiveMethods] = useQueryParamSetState<string>('m_net', methods);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return entries.filter((n) => {
      if (activeMethods.size > 0 && !activeMethods.has(n.method)) return false;
      const bucket: NetStatusBucket = n.failed
        ? 'failed'
        : n.status == null
          ? 'failed'
          : n.status >= 500
            ? '5xx'
            : n.status >= 400
              ? '4xx'
              : n.status >= 300
                ? '3xx'
                : '2xx';
      if (!buckets.has(bucket)) return false;
      if (needle && !n.url.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [entries, q, buckets, activeMethods]);

  const isFiltered =
    q !== '' || buckets.size !== NET_STATUS_BUCKETS.length || activeMethods.size !== methods.length;

  return (
    <>
      <FilterBar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="URL を検索"
        chips={[
          ...NET_STATUS_BUCKETS.map((b) => ({
            key: `st-${b}`,
            label: b,
            active: buckets.has(b),
            onToggle: () => toggleSet(buckets, b, setBuckets, NET_STATUS_BUCKETS),
          })),
          ...methods.map((m) => ({
            key: `m-${m}`,
            label: m,
            active: activeMethods.has(m),
            onToggle: () => toggleSet(activeMethods, m, setActiveMethods, methods),
          })),
        ]}
        showing={filtered.length}
        total={entries.length}
        canReset={isFiltered}
        onReset={() => {
          setQ('');
          setBuckets(new Set(NET_STATUS_BUCKETS));
          setActiveMethods(new Set(methods));
        }}
      />
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
          {filtered.map((n) => {
            const bad = n.failed || (n.status ?? 0) >= 400;
            return (
              <tr key={n.id} className={cn(bad ? 'text-bad' : 'text-ink')}>
                <td className="px-3 py-1.5 font-mono">{n.method}</td>
                <td className="px-3 py-1.5 font-mono">
                  <span className="block max-w-[260px] truncate">{n.url}</span>
                </td>
                <td className="px-3 py-1.5 font-mono">{n.status ?? (n.failed ? 'FAIL' : '')}</td>
                <td className="px-3 py-1.5 text-ink-muted">{n.resourceType}</td>
                <td className="px-3 py-1.5 text-ink-muted">{n.durationMs ?? ''} ms</td>
              </tr>
            );
          })}
          {filtered.length === 0 && (
            <tr>
              <td className="p-4 text-ink-muted" colSpan={5}>
                {entries.length === 0 ? 'なし' : 'フィルタに該当なし'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder: string;
  chips: { key: string; label: string; active: boolean; onToggle: () => void }[];
  showing: number;
  total: number;
  canReset: boolean;
  onReset: () => void;
}

function FilterBar(props: FilterBarProps) {
  return (
    <div className="flex flex-col gap-2 border-b border-line bg-bg-subtle px-3 py-2 text-[11px]">
      <input
        data-inspector-filter="true"
        type="search"
        value={props.searchValue}
        onChange={(e) => props.onSearchChange(e.target.value)}
        placeholder={props.searchPlaceholder}
        className="w-full rounded border border-line bg-bg-panel px-2 py-1 font-mono text-[11px] text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {props.chips.map((c) => (
          <button
            key={c.key}
            onClick={c.onToggle}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors',
              c.active
                ? 'border-accent bg-accent/15 text-accent'
                : 'border-line text-ink-faint hover:border-ink-muted hover:text-ink-muted',
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-ink-faint">
        <span>
          showing {props.showing} of {props.total}
        </span>
        {props.canReset && (
          <button onClick={props.onReset} className="underline hover:text-ink-muted">
            reset
          </button>
        )}
      </div>
    </div>
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

/**
 * URL の query parameter と同期する string state。
 * read on first mount, write back on change で shareable URL を維持する。
 */
function useQueryParamState(
  key: string,
  defaultValue: string,
  opts: { history?: 'push' | 'replace' } = {},
): [string, (v: string) => void] {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get(key) ?? defaultValue;
  const [value, setValue] = useState(initial);

  // URL → state (route 直叩きで戻った場合の同期)。 dependency に key を含めず、
  // params 変化のみで同期して input 入力中の cursor jump を避ける。
  useEffect(() => {
    const fromUrl = params.get(key) ?? defaultValue;
    setValue((cur) => (cur === fromUrl ? cur : fromUrl));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const update = (v: string) => {
    setValue(v);
    const next = new URLSearchParams(params.toString());
    if (v === defaultValue) next.delete(key);
    else next.set(key, v);
    const href = next.toString() ? `?${next.toString()}` : '?';
    if (opts.history === 'push') router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
  };

  return [value, update];
}

/**
 * URL の query parameter と同期する Set<string> state (chip 状態用)。
 * URL では comma-separated で表現。 「全選択」を default として URL に出さない。
 */
function useQueryParamSetState<T extends string>(
  key: string,
  allValues: readonly string[],
): [Set<T>, (next: Set<T>) => void] {
  const router = useRouter();
  const params = useSearchParams();
  const raw = params.get(key);
  const initial = useMemo(() => {
    if (raw == null) return new Set(allValues as readonly T[]);
    if (raw === '') return new Set<T>();
    return new Set(raw.split(',').filter((v) => allValues.includes(v)) as T[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, allValues.join(',')]);
  const [value, setValue] = useState<Set<T>>(initial);

  useEffect(() => {
    setValue(initial);
  }, [initial]);

  const update = (next: Set<T>) => {
    setValue(next);
    const params2 = new URLSearchParams(params.toString());
    const isAll = next.size === allValues.length && allValues.every((v) => next.has(v as T));
    if (isAll) params2.delete(key);
    else params2.set(key, Array.from(next).join(','));
    router.replace(`?${params2.toString()}`, { scroll: false });
  };

  return [value, update];
}

function toggleSet<T extends string>(
  cur: Set<T>,
  v: T,
  set: (next: Set<T>) => void,
  allValues: readonly string[],
): void {
  const next = new Set(cur);
  if (next.has(v)) {
    // 「全部 OFF」を許すと「常に空」になり混乱する。 最後の 1 個を外そうとしたら
    // 「全部 ON に戻す」semantics にする (典型的な filter UX)。
    if (next.size === 1) {
      set(new Set(allValues as readonly T[]));
      return;
    }
    next.delete(v);
  } else {
    next.add(v);
  }
  set(next);
}
