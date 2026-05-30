'use client';

import { FormEvent, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OriginSpec, StopConditions } from '@testworker/shared';
import { launchApp } from '@/lib/api';
import { cn } from '@/lib/cn';
import { parseOriginSpecJson, prettyOriginSpec, webOriginSpecForStartUrl } from '@/lib/origin-spec';

const VIEWPORT_PRESETS = [
  { id: '1280x800', label: '1280 x 800', width: 1280, height: 800 },
  { id: '1440x900', label: '1440 x 900', width: 1440, height: 900 },
  { id: '375x667', label: 'Mobile 375 x 667', width: 375, height: 667 },
  { id: 'custom', label: 'Custom', width: 1280, height: 800 },
] as const;

const NUMBER_LIMITS = {
  maxDepth: { min: 0, max: 20 },
  maxPages: { min: 1, max: 2000 },
  maxDurationSec: { min: 1, max: 86_400 },
  maxErrors: { min: 1, max: 100_000 },
  maxNetworkFails: { min: 1, max: 100_000 },
  stableForN: { min: 1, max: 1000 },
  maxScreenshots: { min: 1, max: 2000 },
  navTimeoutMs: { min: 1000, max: 120000 },
  waitAfterNavMs: { min: 0, max: 10000 },
} as const;

const SCOPE_PRESETS = [
  { id: 'same-host', label: 'Same host' },
  { id: 'same-host-port', label: 'Same host:port' },
  { id: 'subdomains', label: 'Same host + subdomain' },
  { id: 'custom', label: 'Custom' },
] as const;

const STOP_PRESETS = [
  { id: 'quick', label: 'Quick' },
  { id: 'time-boxed', label: 'Time-boxed' },
  { id: 'quality-gate', label: 'Quality-gate' },
  { id: 'goal-oriented', label: 'Goal-oriented' },
  { id: 'advanced', label: 'Advanced' },
] as const;

type ScopePreset = (typeof SCOPE_PRESETS)[number]['id'];
type StopPreset = (typeof STOP_PRESETS)[number]['id'];
type Step = 1 | 2 | 3;
type ReachStatus = 'idle' | 'checking' | 'ok' | 'bad';

export function NewRunForm({ recentUrls }: { recentUrls: string[] }) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>(1);
  const [startUrl, setStartUrl] = useState(recentUrls[0] ?? 'https://example.com');
  const [appName, setAppName] = useState(defaultAppName(recentUrls[0] ?? 'https://example.com'));
  const [appNameTouched, setAppNameTouched] = useState(false);
  const [reachStatus, setReachStatus] = useState<ReachStatus>('idle');
  const [maxDepth, setMaxDepth] = useState(3);
  const [maxPages, setMaxPages] = useState(20);
  const [stopPreset, setStopPreset] = useState<StopPreset>('quick');
  const [maxDurationSec, setMaxDurationSec] = useState(120);
  const [maxErrors, setMaxErrors] = useState(10);
  const [maxNetworkFails, setMaxNetworkFails] = useState<number | ''>('');
  const [stableForN, setStableForN] = useState<number | ''>('');
  const [untilUrl, setUntilUrl] = useState('/dashboard');
  const [untilSelector, setUntilSelector] = useState('');
  const [maxScreenshots, setMaxScreenshots] = useState<number | ''>('');
  const [stopCombine, setStopCombine] = useState<StopConditions['combine']>('any');
  const [scopePreset, setScopePreset] = useState<ScopePreset>('same-host-port');
  const [customOriginSpec, setCustomOriginSpec] = useState('');
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

  const normalizedStartUrl = useMemo(() => normalizeStartUrl(startUrl), [startUrl]);
  const urlError = useMemo(() => validateStartUrl(startUrl), [startUrl]);
  const viewport = useMemo(() => {
    const preset = VIEWPORT_PRESETS.find((p) => p.id === viewportId) ?? VIEWPORT_PRESETS[0];
    return preset.id === 'custom' ? customViewport : { width: preset.width, height: preset.height };
  }, [customViewport, viewportId]);
  const scope = useMemo(
    () => resolveScope(scopePreset, normalizedStartUrl, customOriginSpec),
    [customOriginSpec, normalizedStartUrl, scopePreset],
  );
  const stopConditions = useMemo(
    () =>
      resolveStopConditions({
        stopPreset,
        maxDepth,
        maxPages,
        maxDurationSec,
        maxErrors,
        maxNetworkFails,
        stableForN,
        untilUrl,
        untilSelector,
        maxScreenshots,
        stopCombine,
      }),
    [
      maxDepth,
      maxDurationSec,
      maxErrors,
      maxNetworkFails,
      maxPages,
      maxScreenshots,
      stableForN,
      stopCombine,
      stopPreset,
      untilSelector,
      untilUrl,
    ],
  );
  const numbersValid =
    within(maxDepth, NUMBER_LIMITS.maxDepth) &&
    within(maxPages, NUMBER_LIMITS.maxPages) &&
    within(navTimeoutMs, NUMBER_LIMITS.navTimeoutMs) &&
    within(waitAfterNavMs, NUMBER_LIMITS.waitAfterNavMs) &&
    viewport.width > 0 &&
    viewport.height > 0;
  const canSubmit =
    !isPending && !urlError && !scope.error && !stopConditions.error && numbersValid;
  const canGoNext =
    step === 1 ? !urlError && appName.trim().length > 0 : step === 2 ? !scope.error : true;

  useEffect(() => {
    if (!appNameTouched) setAppName(defaultAppName(normalizedStartUrl));
  }, [appNameTouched, normalizedStartUrl]);

  useEffect(() => {
    if (urlError) {
      setReachStatus('idle');
      return;
    }
    setReachStatus('checking');
    const timeout = window.setTimeout(() => {
      fetch(normalizedStartUrl, { method: 'HEAD', mode: 'no-cors' })
        .then(() => setReachStatus('ok'))
        .catch(() => setReachStatus('bad'));
    }, 400);
    return () => window.clearTimeout(timeout);
  }, [normalizedStartUrl, urlError]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    setMessage(null);
    startTransition(async () => {
      try {
        const response = await launchApp({
          startUrl: normalizedStartUrl,
          appName: appName.trim(),
          maxDepth,
          maxPages,
          stopConditions: stopConditions.value,
          originSpec: scope.originSpec,
          sameOriginOnly: scopePreset === 'same-host-port',
          respectRobots,
          navTimeoutMs,
          waitAfterNavMs,
          viewport,
          includeUrlPatterns: splitPatterns(includePatterns),
          excludeUrlPatterns: splitPatterns(excludePatterns),
          userAgent: userAgent.trim() || undefined,
          captureWebVitals,
          collectStorage: false,
        });
        setMessage({ tone: 'ok', text: `App "${appName.trim()}" を作成しました。` });
        setIsOpen(false);
        if (response.appId) router.push(`/apps/${response.appId}`);
        else router.refresh();
        window.setTimeout(() => router.refresh(), 1500);
      } catch (err) {
        setMessage({
          tone: 'bad',
          text: err instanceof Error ? err.message : 'App の作成に失敗しました。',
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
          + Add App
        </button>
        {message && <div className="mt-3 text-xs text-ok">{message.text}</div>}
      </aside>
    );
  }

  return (
    <aside className="rounded-lg border border-line bg-bg-subtle shadow-sm shadow-black/10 xl:sticky xl:top-16 xl:self-start">
      <form onSubmit={submit} className="p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Add App</h2>
            <StepDots step={step} />
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:text-ink"
          >
            Close
          </button>
        </div>

        <div className="space-y-4">
          {step === 1 && (
            <>
              <label
                className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
                title="http / https の対象 URL を入力します。"
              >
                URL
                <input
                  required
                  type="text"
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
                {urlError && (
                  <div className="mt-1 text-[11px] normal-case text-bad">{urlError}</div>
                )}
                {!urlError && (
                  <div className="mt-1 text-[11px] normal-case text-ink-muted">
                    Reach:{' '}
                    {reachStatus === 'checking'
                      ? 'checking'
                      : reachStatus === 'ok'
                        ? 'ok'
                        : reachStatus === 'bad'
                          ? 'failed'
                          : 'idle'}
                  </div>
                )}
              </label>

              <label
                className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
                title="Apps 一覧で表示する名前です。"
              >
                App name
                <input
                  required
                  value={appName}
                  onChange={(e) => {
                    setAppNameTouched(true);
                    setAppName(e.target.value);
                  }}
                  className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                />
              </label>
            </>
          )}

          {step === 3 && (
            <>
              <label
                className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
                title="Run の終了条件 preset です。"
              >
                Stop preset
                <select
                  value={stopPreset}
                  onChange={(e) => setStopPreset(e.target.value as StopPreset)}
                  className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                >
                  {STOP_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              {stopPreset === 'time-boxed' && (
                <NumberField
                  label="Max duration sec"
                  value={maxDurationSec}
                  onChange={setMaxDurationSec}
                  min={NUMBER_LIMITS.maxDurationSec.min}
                  max={NUMBER_LIMITS.maxDurationSec.max}
                />
              )}

              {stopPreset === 'quality-gate' && (
                <NumberField
                  label="Max errors"
                  value={maxErrors}
                  onChange={setMaxErrors}
                  min={NUMBER_LIMITS.maxErrors.min}
                  max={NUMBER_LIMITS.maxErrors.max}
                />
              )}

              {stopPreset === 'goal-oriented' && (
                <label
                  className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
                  title="到達したら Run を終了する URL pattern です。"
                >
                  Until URL
                  <input
                    value={untilUrl}
                    onChange={(e) => setUntilUrl(e.target.value)}
                    className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                  />
                </label>
              )}

              {stopPreset === 'advanced' && (
                <details open className="rounded-md border border-line bg-bg/60 px-3 py-2 text-sm">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-ink-faint hover:text-ink-muted">
                    Stop conditions
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
                      Combine
                      <select
                        value={stopCombine}
                        onChange={(e) =>
                          setStopCombine(e.target.value as StopConditions['combine'])
                        }
                        className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                      >
                        <option value="any">Any</option>
                        <option value="all">All</option>
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <NumberField
                        label="Duration sec"
                        value={maxDurationSec}
                        onChange={setMaxDurationSec}
                        min={NUMBER_LIMITS.maxDurationSec.min}
                        max={NUMBER_LIMITS.maxDurationSec.max}
                      />
                      <OptionalNumberField
                        label="Screenshots"
                        value={maxScreenshots}
                        onChange={setMaxScreenshots}
                        min={NUMBER_LIMITS.maxScreenshots.min}
                        max={NUMBER_LIMITS.maxScreenshots.max}
                      />
                      <NumberField
                        label="Errors"
                        value={maxErrors}
                        onChange={setMaxErrors}
                        min={NUMBER_LIMITS.maxErrors.min}
                        max={NUMBER_LIMITS.maxErrors.max}
                      />
                      <OptionalNumberField
                        label="Network fails"
                        value={maxNetworkFails}
                        onChange={setMaxNetworkFails}
                        min={NUMBER_LIMITS.maxNetworkFails.min}
                        max={NUMBER_LIMITS.maxNetworkFails.max}
                      />
                      <OptionalNumberField
                        label="Stable steps"
                        value={stableForN}
                        onChange={setStableForN}
                        min={NUMBER_LIMITS.stableForN.min}
                        max={NUMBER_LIMITS.stableForN.max}
                      />
                    </div>
                    <label className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
                      Until URL
                      <input
                        value={untilUrl}
                        onChange={(e) => setUntilUrl(e.target.value)}
                        className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-wider text-ink-faint">
                      Until selector
                      <input
                        value={untilSelector}
                        onChange={(e) => setUntilSelector(e.target.value)}
                        className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                      />
                    </label>
                  </div>
                </details>
              )}
              {stopConditions.error && (
                <div className="text-[11px] text-bad">{stopConditions.error}</div>
              )}

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
            </>
          )}

          {step === 2 && (
            <>
              <label
                className="block text-xs font-medium uppercase tracking-wider text-ink-faint"
                title="クロールで辿る URL の origin scope です。"
              >
                Scope
                <select
                  value={scopePreset}
                  onChange={(e) => {
                    const next = e.target.value as ScopePreset;
                    if (next === 'custom' && !customOriginSpec && !urlError) {
                      const current = resolveScope(
                        scopePreset,
                        normalizedStartUrl,
                        customOriginSpec,
                      ).originSpec;
                      if (current) setCustomOriginSpec(prettyOriginSpec(current));
                    }
                    setScopePreset(next);
                  }}
                  className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 text-sm normal-case tracking-normal text-ink outline-none focus:border-accent"
                >
                  {SCOPE_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>

              {scopePreset === 'custom' && (
                <TextareaField
                  label="Origin spec JSON"
                  value={customOriginSpec}
                  onChange={setCustomOriginSpec}
                  title="OriginSpec JSON を直接編集します。"
                  rows={7}
                />
              )}
              {scope.error && <div className="text-[11px] text-bad">{scope.error}</div>}
              {!scope.error && scope.originSpec && (
                <div className="rounded-md border border-line bg-bg/60 px-3 py-2 font-mono text-[11px] text-ink-muted">
                  {scopePreview(normalizedStartUrl, scopePreset)}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid gap-2 text-xs text-ink-muted">
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
            </>
          )}
        </div>

        {message && (
          <div className={cn('mt-3 text-xs', message.tone === 'ok' ? 'text-ok' : 'text-bad')}>
            {message.text}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          {step > 1 && (
            <button
              type="button"
              onClick={() => setStep((step - 1) as Step)}
              className="h-10 flex-1 rounded-md border border-line px-4 text-sm text-ink-muted hover:text-ink"
            >
              Back
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              disabled={!canGoNext}
              onClick={() => setStep((step + 1) as Step)}
              className={cn(
                'h-10 flex-1 rounded-md border border-accent-soft bg-accent px-4 text-sm font-medium text-bg transition-colors',
                'hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-panel disabled:text-ink-faint',
              )}
            >
              Next
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSubmit}
              className={cn(
                'h-10 flex-1 rounded-md border border-accent-soft bg-accent px-4 text-sm font-medium text-bg transition-colors',
                'hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-panel disabled:text-ink-faint',
              )}
            >
              {isPending ? 'Starting...' : 'Save & Start crawl'}
            </button>
          )}
        </div>
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

function OptionalNumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number | '';
  min: number;
  max: number;
  onChange: (value: number | '') => void;
}) {
  return (
    <label className="text-xs font-medium uppercase tracking-wider text-ink-faint">
      {label}
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          if (e.target.value === '') onChange('');
          else if (!Number.isNaN(e.target.valueAsNumber)) onChange(e.target.valueAsNumber);
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
  rows = 3,
  onChange,
}: {
  label: string;
  value: string;
  title: string;
  rows?: number;
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
        rows={rows}
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

function StepDots({ step }: { step: Step }) {
  return (
    <div className="mt-1 flex gap-1" aria-label={`step ${step} of 3`}>
      {[1, 2, 3].map((value) => (
        <span
          key={value}
          className={cn('h-1.5 w-6 rounded-full', value <= step ? 'bg-accent' : 'bg-line')}
        />
      ))}
    </div>
  );
}

function splitPatterns(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function normalizeStartUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

function validateStartUrl(raw: string): string | null {
  if (!raw.trim()) return 'URL は必須です。';
  try {
    const url = new URL(normalizeStartUrl(raw));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'http / https の URL を入力してください。';
    }
    return null;
  } catch {
    return '有効な URL を入力してください。';
  }
}

function defaultAppName(raw: string): string {
  try {
    return new URL(normalizeStartUrl(raw)).host || 'New App';
  } catch {
    return 'New App';
  }
}

function scopePreview(startUrl: string, preset: ScopePreset): string {
  try {
    const url = new URL(startUrl);
    if (preset === 'same-host') {
      return `allows ${url.hostname}:3000 / ${url.hostname}:5173 / ${url.hostname}:6006`;
    }
    if (preset === 'subdomains') {
      return `allows ${url.hostname} / app.${url.hostname} / auth.${url.hostname}`;
    }
    if (preset === 'custom') return 'custom OriginSpec JSON をそのまま使います';
    return `allows ${url.host} only; blocks ${url.hostname}:5173`;
  } catch {
    return '';
  }
}

function resolveScope(
  preset: ScopePreset,
  startUrl: string,
  customJson: string,
): { originSpec?: OriginSpec; error: string | null } {
  try {
    if (preset === 'custom') {
      if (!customJson.trim()) return { error: 'OriginSpec JSON は必須です。' };
      return { originSpec: parseOriginSpecJson(customJson), error: null };
    }

    const mapped =
      preset === 'same-host'
        ? 'same-host'
        : preset === 'same-host-port'
          ? 'same-host-port'
          : 'subdomains';
    return { originSpec: webOriginSpecForStartUrl(startUrl, mapped), error: null };
  } catch {
    return { error: 'Scope を生成できる URL を入力してください。' };
  }
}

function resolveStopConditions(input: {
  stopPreset: StopPreset;
  maxDepth: number;
  maxPages: number;
  maxDurationSec: number;
  maxErrors: number;
  maxNetworkFails: number | '';
  stableForN: number | '';
  untilUrl: string;
  untilSelector: string;
  maxScreenshots: number | '';
  stopCombine: StopConditions['combine'];
}): { value: StopConditions; error: string | null } {
  if (input.stopPreset === 'quick') {
    return { value: { combine: 'any', maxPages: input.maxPages }, error: null };
  }
  if (input.stopPreset === 'time-boxed') {
    return { value: { combine: 'any', maxDurationSec: input.maxDurationSec }, error: null };
  }
  if (input.stopPreset === 'quality-gate') {
    return { value: { combine: 'any', maxErrors: input.maxErrors }, error: null };
  }
  if (input.stopPreset === 'goal-oriented') {
    const untilUrl = input.untilUrl.trim();
    return untilUrl
      ? { value: { combine: 'any', untilUrl }, error: null }
      : { value: { combine: 'any' }, error: 'Until URL is required.' };
  }

  const value: StopConditions = {
    combine: input.stopCombine,
    maxDepth: input.maxDepth,
    maxPages: input.maxPages,
    maxDurationSec: input.maxDurationSec,
    maxErrors: input.maxErrors,
  };
  if (input.maxNetworkFails !== '') value.maxNetworkFails = input.maxNetworkFails;
  if (input.stableForN !== '') value.stableForN = input.stableForN;
  if (input.maxScreenshots !== '') value.maxScreenshots = input.maxScreenshots;
  if (input.untilUrl.trim()) value.untilUrl = input.untilUrl.trim();
  if (input.untilSelector.trim()) value.untilSelector = input.untilSelector.trim();
  return { value, error: null };
}

function within(value: number, limits: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= limits.min && value <= limits.max;
}
