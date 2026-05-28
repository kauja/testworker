'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Server Component で取得した値を定期的に Next.js の router.refresh() で
 * 更新するための無音 Client Component (Issue #86)。
 *
 * Server Component 側で「 走行中の run が 1 件でもあれば <AutoRefresh /> を埋める」
 * という条件分岐をするだけで、 client は polling 用 fetch を持たずに済む。
 *
 * tab がバックグラウンドのときは refresh を止めて (SQLite への余計な polling と
 * runner との競合を避ける)、 復帰時に即 1 回 refresh する。
 */
export function AutoRefresh({ intervalMs = 2000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (timer !== null) return;
      timer = setInterval(() => router.refresh(), intervalMs);
    };
    const stop = () => {
      if (timer === null) return;
      clearInterval(timer);
      timer = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [router, intervalMs]);
  return null;
}
