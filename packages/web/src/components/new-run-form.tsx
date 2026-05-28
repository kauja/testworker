'use client';

import { FormEvent, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { launchRun } from '@/lib/api';
import { cn } from '@/lib/cn';

const NUMBER_LIMITS = {
  maxDepth: { min: 0, max: 20 },
  maxPages: { min: 1, max: 2000 },
  navTimeoutMs: { min: 1000, max: 120000 },
  waitAfterNavMs: { min: 0, max: 10000 },
} as const;

export function NewRunForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [startUrl, setStartUrl] = useState('https://example.com');
  const [maxDepth, setMaxDepth] = useState(1);
  const [maxPages, setMaxPages] = useState(10);
  const [sameOriginOnly, setSameOriginOnly] = useState(true);
  const [respectRobots, setRespectRobots] = useState(true);
  const [captureWebVitals, setCaptureWebVitals] = useState(true);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        await launchRun({
          startUrl,
          maxDepth,
          maxPages,
          sameOriginOnly,
          respectRobots,
          navTimeoutMs: 15_000,
          waitAfterNavMs: 500,
          captureWebVitals,
        });
        setMessage({ tone: 'ok', text: 'Run を起動しました。' });
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

  return (
    <form
      onSubmit={submit}
      className="rounded-lg border border-line bg-bg-subtle px-4 py-4 shadow-sm shadow-black/10"
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_120px_120px_auto] lg:items-end">
        <label className="min-w-0 text-xs font-medium uppercase tracking-wider text-ink-faint">
          URL
          <input
            required
            type="url"
            value={startUrl}
            onChange={(e) => setStartUrl(e.target.value)}
            className="mt-1 block h-10 w-full rounded-md border border-line bg-bg px-3 font-mono text-sm normal-case tracking-normal text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-accent"
          />
        </label>
        <NumberField
          label="Depth"
          value={maxDepth}
          onChange={setMaxDepth}
          min={NUMBER_LIMITS.maxDepth.min}
          max={NUMBER_LIMITS.maxDepth.max}
        />
        <NumberField
          label="Pages"
          value={maxPages}
          onChange={setMaxPages}
          min={NUMBER_LIMITS.maxPages.min}
          max={NUMBER_LIMITS.maxPages.max}
        />
        <button
          type="submit"
          disabled={isPending}
          className={cn(
            'h-10 rounded-md border border-accent-soft bg-accent px-4 text-sm font-medium text-bg transition-colors',
            'hover:bg-accent/90 disabled:cursor-not-allowed disabled:border-line disabled:bg-bg-panel disabled:text-ink-faint',
          )}
        >
          {isPending ? 'Starting...' : 'Run'}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-muted">
        <CheckField label="Same origin" checked={sameOriginOnly} onChange={setSameOriginOnly} />
        <CheckField label="Robots" checked={respectRobots} onChange={setRespectRobots} />
        <CheckField label="Web Vitals" checked={captureWebVitals} onChange={setCaptureWebVitals} />
        {message && (
          <span className={message.tone === 'ok' ? 'text-ok' : 'text-bad'}>{message.text}</span>
        )}
      </div>
    </form>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="text-xs font-medium uppercase tracking-wider text-ink-faint">
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

function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2">
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
