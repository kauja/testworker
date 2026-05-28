'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

/**
 * api 接続失敗時 (#141) の Retry ボタン。
 *
 * `next/navigation` の `router.refresh()` で Server Component を再 fetch する。
 * `window.location.reload()` よりサーバ往復が軽い (HTML 全再生成だけで JS bundle は再 download しない)。
 * 連打されると DB 起動を待つループになるので `useTransition` の `isPending` で disable。
 */
export function RetryButton({ label = '再試行' }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={isPending}
      className="rounded border border-bad/40 bg-bad/15 px-3 py-1.5 text-xs text-bad hover:bg-bad/25 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-bad"
    >
      {isPending ? '確認中…' : label}
    </button>
  );
}
