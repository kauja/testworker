import type { GraphPayload, PageDetail, RunDiff, RunSummary } from '@testworker/shared';

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
export const fetchRunDiff = (
  runId: string,
  base: string | 'previous' = 'previous',
  init?: RequestInit,
) => get<RunDiff>(`/runs/${runId}/diff?base=${encodeURIComponent(base)}`, init);

// 常に CLIENT_BASE (ブラウザ到達可能な URL) を使う。
// SSR 時にもこの URL を生成して HTML にシリアライズすることで、 ブラウザが直接
// fetch する screenshot URL を到達可能なものに揃える。 SERVER_BASE (= 例えば
// docker-compose 内の `http://api:3001`) を SSR でシリアライズすると、 ブラウザ
// から `http://api:3001/...` に取りに行ってしまい screenshot 表示が永久に壊れる。
export const assetUrl = (relPath: string) => `${CLIENT_BASE}/assets/${relPath}`;
