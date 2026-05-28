import type { GraphPayload, PageDetail, RunSummary } from '@testworker/shared';

const SERVER_BASE = process.env.API_BASE_URL ?? 'http://api:3001';
const CLIENT_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const base = () => (typeof window === 'undefined' ? SERVER_BASE : CLIENT_BASE);

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base()}${path}`, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(`api ${path} ${res.status}`);
  return (await res.json()) as T;
}

export const apiBase = base;

export const fetchRuns = (init?: RequestInit) => get<RunSummary[]>('/runs', init);
export const fetchGraph = (runId: string, init?: RequestInit) =>
  get<GraphPayload>(`/runs/${runId}/graph`, init);
export const fetchPage = (pageId: string, init?: RequestInit) =>
  get<PageDetail>(`/pages/${pageId}`, init);

export const assetUrl = (relPath: string) =>
  `${typeof window === 'undefined' ? SERVER_BASE : CLIENT_BASE}/assets/${relPath}`;
