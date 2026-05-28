'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function RunsAutoRefresh() {
  const router = useRouter();

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = window.setInterval(refresh, 2000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router]);

  return null;
}
