'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * 日時表示の共通 Component (#175)。
 *
 * SSR で `toLocaleString()` を呼ぶと Node の locale (例: en-US) が固定で焼かれて
 * しまい、 日本語 UI と不整合な「5/28/2026, 5:10:00 PM」 が出る。 さらに
 * client での再 format と hydration が一致せず警告が出るリスクもある。
 *
 * → SSR では ISO 8601 をそのまま出し、 client mount 後に `Intl.DateTimeFormat` /
 *    `Intl.RelativeTimeFormat` で **browser locale** に format する。
 *
 * Product Principles: AI / 外部 SaaS 非依存。 Intl は Node 22 / Chrome 標準 API。
 */
export interface TimeStampProps {
  /** ISO 8601 文字列 (例: `2026-05-29T12:34:56.789Z`)。 */
  value: string;
  /**
   * `absolute` (default): `2026/05/29 12:34` など (browser locale)。
   * `relative`: `3 分前` / `1 時間前` / `昨日 12:34` 等。 1 週間を超えたら絶対表示に fallback。
   */
  mode?: 'absolute' | 'relative';
  /** Intl.DateTimeFormat の options 上書き。 mode=absolute / relative の長文 tooltip 双方で使う。 */
  options?: Intl.DateTimeFormatOptions;
  /** 余計な whitespace を消したい単行表示用。 */
  className?: string;
}

const DEFAULT_OPTIONS: Intl.DateTimeFormatOptions = {
  dateStyle: 'short',
  timeStyle: 'short',
};

const WEEK_SECONDS = 7 * 24 * 60 * 60;

export function TimeStamp({ value, mode = 'absolute', options, className }: TimeStampProps) {
  const date = useMemo(() => new Date(value), [value]);
  const [mounted, setMounted] = useState(false);
  // 1 分ごとに relative 表示を tick 更新する (mode=relative のときのみ意味あり)。
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
    if (mode !== 'relative') return;
    const id = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [mode]);

  if (!mounted) {
    // SSR 段階では ISO をそのまま (hydration mismatch を絶対に起こさない)。
    // mount 後に上書きされるが、 一瞬の生 ISO は dev tools でも実害がない。
    return (
      <span className={className} suppressHydrationWarning>
        {value}
      </span>
    );
  }

  const fmtOptions = options ?? DEFAULT_OPTIONS;
  const absolute = new Intl.DateTimeFormat(undefined, fmtOptions).format(date);

  if (mode === 'relative') {
    // tick は依存に明示せず side effect は interval で更新する。 関数呼び出しで読む。
    void tick;
    const rel = formatRelative(date);
    return (
      <span className={className} title={absolute}>
        {rel ?? absolute}
      </span>
    );
  }

  return (
    <span className={className} title={value}>
      {absolute}
    </span>
  );
}

/**
 * `Intl.RelativeTimeFormat` で browser locale の相対表示を返す。 1 週間以上前は null。
 */
function formatRelative(date: Date): string | null {
  const diffSec = (date.getTime() - Date.now()) / 1000;
  if (Math.abs(diffSec) > WEEK_SECONDS) return null;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(diffSec);
  if (abs < 60) return rtf.format(Math.round(diffSec), 'second');
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return rtf.format(Math.round(diffSec / 3600), 'hour');
  return rtf.format(Math.round(diffSec / 86_400), 'day');
}
