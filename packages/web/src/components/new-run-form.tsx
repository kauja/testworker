'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { launchRun } from '@/lib/api';
import { cn } from '@/lib/cn';

const VIEWPORT_PRESETS = [
  { id: '1280x800', label: '1280 x 800', width: 1280, height: 800 },
  { id: '1440x900', label: '1440 x 900', width: 1440, height: 900 },
  { id: '375x667', label: 'Mobile 375 x 667', width: 375, height: 667 },
  { id: 'custom', label: 'Custom', width: 1280, height: 800 },
] as const;

const NUMBER_LIMITS = {
  maxDepth: { min: 0, max: 20 },
  maxPages: { min: 1, max: 2000 },
  navTimeoutMs: { min: 1000, max: 120000 },
  waitAfterNavMs: { min: 0, max: 10000 },
} as const;

export function NewRunForm({ recentUrls }: { recentUrls: string[] }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [startUrl, setStartUrl] = useState(recentUrls[0] ?? 'https://example.com');
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(50);
  const [sameOriginOnly, setSameOriginOnly] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [captureWebVitals, setCaptureWebVitals] = useState(true);
  const [viewportId, setViewportId] = useState<(typeof VIEWPORT_PRESETS)[number]['id']>('1280x800');
  const [customViewport, setCustomViewport] = useState({ width: 1280, height: 800 });
  const [includePatterns, setIncludePatterns] = useState('');
  const [excludePatterns, setExcludePatterns] = useState('');
  const [navTimeoutMs, setNavTimeoutMs] = useState(15_000);
  const [waitAfterNavMs, setWaitAfterNavMs] = useState(500);
  const [userAgent, setUserAgent] = useState('');
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const urlError = useMemo(() => validateStartUrl(startUrl), [startUrl]);
  const viewport = useMemo(() => {
    const preset = VIEWPORT_PRESETS.find((p) => p.id === viewportId) ?? VIEWPORT_PRESETS[0];
    return preset.id === 'custom' ? customViewport : { width: preset.width, height: preset.height };
  }, [customViewport, viewportId]);
  const numbersValid =
    within(maxDepth, NUMBER_LIMITS.maxDepth) &&
    within(maxPages, NUMBER_LIMITS.maxPages) &&
    within(navTimeoutMs, NUMBER_LIMITS.navTimeoutMs) &&
    within(waitAfterNavMs, NUMBER_LIMITS.waitAfterNavMs) &&
    viewport.width > 0 &&
    viewport.height > 0;
  const canSubmit = !isPending && !urlError && numbersValid;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage(null);
    startTransition(async () => {
      try {
        await launchRun({
          startUrl,
          maxDepth,
          maxPages,
          sameOriginOnly,
          respectRobots,
          navTimeoutMs,
          waitAfterNavMs,
          viewport,
          includeUrlPatterns: splitPatterns(includePatterns),
          excludeUrlPatterns: splitPatterns(excludePatterns),
          userAgent: userAgent.trim() || undefined,
          captureWebVitals,
        });
        setMessage({ tone: 'ok', text: 'Run を起動しました。' });
        setIsOpen(false);
        router.refresh();
        window.setTimeout(() => router.refresh(), 1500);
      } catch (err) {
        setMessage({
          tone: 'bad',
          text: err instanceof Error ? err.message : 'Run の起動に失敗しました。',
        });
      }
    });
  };

  if (!isOpen) {
    return (
      <aside className="rounded-lg border border-line bg-bg-subtle px-4 py-4">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="h-10 w-full rounded-md border border-accent-soft bg-accent px-4 text-sm font-medium text-bg transition-colors hover:bg-accent/90"
        >
          + New Run
        </button>
        {message && <div className="mt-3 text-xs text-ok">{message.text}</div>}
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-line bg-bg-subtle shadow-sm shadow-black/10 xl:sticky xl:top-16 xl:self-start">
      <form onSubmit={submit} className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">New Run</h2>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          <label
            className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
            title="http / https の対象 URL を入力します。"
          >
            URL
            <input
              required
              type="url"
              list="recent-run-urls"
              value={startUrl}
              onChange={(e) => setStartUrl(e.target.value)}
              aria-invalid={urlError ? 'true' : 'false'}
              className={cn(
                'mt-1 block h-10 w-full rounded-md border bg-bg px-3 font-mono text-sm normal-case tracking-normal text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent',
                urlError ? 'border-bad/70' : 'border-line',
              )}
            />
            <datalist id="recent-run-urls">
              {recentUrls.map((url) => (
                <option key={url} value={url} />
              ))}
            </datalist>
            {urlError && <div className="mt-1 text-[11px] normal-case text-bad">{urlError}</div>}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Depth"
              title="リンクを何階層まで辿るかを指定します。"
              value={maxDepth}
              onChange={setMaxDepth}
              min={NUMBER_LIMITS.maxDepth.min}
              max={NUMBER_LIMITS.maxDepth.max}
            />
            <NumberField
              label="Pages"
              title="1 run で保存する最大ページ数です。"
              value={maxPages}
              onChange={setMaxPages}
              min={NUMBER_LIMITS.maxPages.min}
              max={NUMBER_LIMITS.maxPages.max}
            />
          </div>

          <label
            className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
            title="スクリーンショットと DOM 計測に使うブラウザサイズです。"
          >
            Viewport
            <select
              value={viewportId}
              onChange={(e) => setViewportId(e.target.value as typeof viewportId)}
              className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
            >
              {VIEWPORT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {viewportId === 'custom' && (
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Width"
                value={customViewport.width}
                onChange={(width) => setCustomViewport((v) => ({ ...v, width }))}
                min={1}
                max={4000}
              />
              <NumberField
                label="Height"
                value={customViewport.height}
                onChange={(height) => setCustomViewport((v) => ({ ...v, height }))}
                min={1}
                max={4000}
              />
            </div>
          )}

          <div className="grid gap-2 text-xs text-ink-muted">
            <CheckField
              label="Same origin"
              title="外部リンクを追跡せず、開始 URL と同じ origin だけを辿ります。"
              checked={sameOriginOnly}
              onChange={setSameOriginOnly}
            />
            <CheckField
              label="Respect robots.txt"
              title="robots.txt の Disallow / Allow をクロール時に尊重します。"
              checked={respectRobots}
              onChange={setRespectRobots}
            />
            <CheckField
              label="Capture Web Vitals"
              title="LCP / CLS / INP などのページ指標を保存します。"
              checked={captureWebVitals}
              onChange={setCaptureWebVitals}
            />
          </div>

          <details className="rounded-md border border-line bg-bg/60 px-3 py-2 text-sm">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-ink-faint hover:text-ink-muted">
              Advanced
            </summary>
            <div className="mt-3 space-y-3">
              <TextareaField
                label="Include patterns"
                value={includePatterns}
                onChange={setIncludePatterns}
                title="一致した URL だけを保存します。1 行 1 pattern。"
              />
              <TextareaField
                label="Exclude patterns"
                value={excludePatterns}
                onChange={setExcludePatterns}
                title="一致した URL を除外します。1 行 1 pattern。"
              />
              <div className="grid grid-cols-2 gap-3">
                <NumberField
                  label="Nav timeout"
                  value={navTimeoutMs}
                  onChange={setNavTimeoutMs}
                  min={NUMBER_LIMITS.navTimeoutMs.min}
                  max={NUMBER_LIMITS.navTimeoutMs.max}
                />
                <NumberField
                  label="Wait after nav"
                  value={waitAfterNavMs}
                  onChange={setWaitAfterNavMs}
                  min={NUMBER_LIMITS.waitAfterNavMs.min}
                  max={NUMBER_LIMITS.waitAfterNavMs.max}
                />
              </div>
              <label
                className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
                title="必要なときだけ User-Agent を上書きします。"
              >
                User agent
                <input
                  value={userAgent}
                  onChange={(e) => setUserAgent(e.target.value)}
                  className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                />
              </label>
            </div>
          </details>
        </div>

        {message && (
          <div className={cn('mt-3 text-xs', message.tone === 'ok' ? 'text-ok' : 'text-bad')}>
            {message.text}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            'mt-4 h-10 w-full rounded-md border border-accent-soft bg-accent px-4 text-sm font-medium text-bg transition-colors',
            'hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-panel disabled:text-ink-faint',
          )}
        >
          {isPending ? 'Starting...' : 'Run'}
        </button>
      </form>
    </aside>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  title,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  title?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs font-medium uppercase tracking-wider text-ink-faint" title={title}>
      {label}
      <input
        required
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          if (!Number.isNaN(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
        }}
        className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none transition-colors focus:border-accent"
      />
    </label>
  );
}

function TextareaField({
  label,
  value,
  title,
  onChange,
}: {
  label: string;
  value: string;
  title: string;
  onChange: (value: string) => void;
}) {
  return (
    <label
      className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
      title={title}
    >
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="mt-1 block w-full resize-y rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs normal-case tracking-normal text-ink outline-none focus:border-accent"
      />
    </label>
  );
}

function CheckField({
  label,
  checked,
  title,
  onChange,
}: {
  label: string;
  checked: boolean;
  title: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 rounded border-line bg-bg text-accent"
      />
      {label}
    </label>
  );
}

function splitPatterns(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function validateStartUrl(raw: string): string | null {
  if (!raw.trim()) return 'URL は必須です。';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'http / https の URL を入力してください。';
    }
    return null;
  } catch {
    return '有効な URL を入力してください。';
  }
}

function within(value: number, limits: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= limits.min && value <= limits.max;
}
