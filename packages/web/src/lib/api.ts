import type {
  ErrorGroup,
  GraphPayload,
  PageDetail,
  Run,
  RunDiff,
  RunLaunchInput,
  RunLaunchResponse,
  RunSummary,
} from '@testworker/shared';

const SERVER_BASE = process.env.API_BASE_URL ?? 'http://api:3001';
const CLIENT_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3001';

const base = () => (typeof window === 'undefined' ? SERVER_BASE : CLIENT_BASE);

/**
 * api 呼び出しが失敗したときの error 種別 (#141)。
 *  - `unreachable`: api server に到達不能 (fetch 自体が throw、 typically `ECONNREFUSED`)。
 *      `make up` が走っていない / web より先に web を起動したケース。
 *  - `db_not_ready`: api は応答するが DB が未マイグレート (HTTP 503 + `error: db_not_ready`)。
 *      `make migrate` 実行で復旧する。
 *  - `http`: その他の HTTP error (404 / 5xx 等)。
 */
export type ApiErrorKind = 'unreachable' | 'db_not_ready' | 'http';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly hint?: string;
  constructor(kind: ApiErrorKind, message: string, opts?: { status?: number; hint?: string }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts?.status;
    this.hint = opts?.hint;
  }
}

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, { cache: 'no-store', ...init });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError('unreachable', `api ${path} unreachable: ${msg}`, {
      hint: 'API server に到達できません。 `make up` で api コンテナが起動しているか確認してください。',
    });
  }
  if (res.status === 503) {
    let body: { error?: string; hint?: string } = {};
    try {
      body = (await res.json()) as typeof body;
    } catch {
      /* noop */
    }
    if (body.error === 'db_not_ready') {
      throw new ApiError('db_not_ready', `api ${path} 503 db_not_ready`, {
        status: 503,
        hint: body.hint,
      });
    }
    throw new ApiError('http', `api ${path} 503`, { status: 503 });
  }
  if (!res.ok) {
    throw new ApiError('http', `api ${path} ${res.status}`, { status: res.status });
  }
  return (await res.json()) as T;
}

async function post<T>(path: string, body: unknown, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    const headers = new Headers(init?.headers);
    headers.set('content-type', 'application/json');
    res = await fetch(`${base()}${path}`, {
      ...init,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new ApiError('unreachable', `api ${path} unreachable: ${msg}`, {
      hint: 'API server に到達できません。 `make up` で api コンテナが起動しているか確認してください。',
    });
  }
  if (!res.ok) {
    let hint: string | undefined;
    try {
      const parsed = (await res.json()) as { hint?: string; message?: string; error?: string };
      hint = parsed.hint ?? parsed.message ?? parsed.error;
    } catch {
      /* noop */
    }
    throw new ApiError('http', `api ${path} ${res.status}`, { status: res.status, hint });
  }
  return (await res.json()) as T;
}

export const apiBase = base;

export const fetchRuns = (init?: RequestInit) => get<RunSummary[]>('/runs', init);
export const launchRun = (input: RunLaunchInput, init?: RequestInit) =>
  post<RunLaunchResponse>('/runs', input, init);
export const fetchRun = (runId: string, init?: RequestInit) => get<Run>(`/runs/${runId}`, init);
export const fetchGraph = (runId: string, init?: RequestInit) =>
  get<GraphPayload>(`/runs/${runId}/graph`, init);
export const fetchPage = (pageId: string, init?: RequestInit) =>
  get<PageDetail>(`/pages/${pageId}`, init);
export const fetchErrorGroups = (runId: string, init?: RequestInit) =>
  get<ErrorGroup[]>(`/runs/${runId}/errors/grouped`, init);
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

/**
 * HAR ダウンロード URL (Issue #87)。 ブラウザから download attribute で開く前提。
 * `/runs/*` の wildcard CORS を回避するため別 path (`/har/:id`) に置いている (Issue #95)。
 */
export const harDownloadUrl = (runId: string) => `${CLIENT_BASE}/har/${runId}`;
