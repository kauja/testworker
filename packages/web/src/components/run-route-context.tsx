'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Run } from '@testworker/shared';

const RunRouteContext = createContext<Run | null>(null);

export function RunRouteProvider({ run, children }: { run: Run; children: ReactNode }) {
  return <RunRouteContext.Provider value={run}>{children}</RunRouteContext.Provider>;
}

export function useRunRoute(): Run {
  const run = useContext(RunRouteContext);
  if (!run) throw new Error('useRunRoute must be used inside RunRouteProvider');
  return run;
}
