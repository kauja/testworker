import { z } from 'zod';

export const RunStatus = z.enum(['queued', 'running', 'completed', 'failed', 'canceled']);
export type RunStatus = z.infer<typeof RunStatus>;

export const NavigationTrigger = z.enum([
  'initial',
  'link',
  'form-submit',
  'button',
  'history',
  'spa-route',
  'spa-dom',
]);
export type NavigationTrigger = z.infer<typeof NavigationTrigger>;

export const CrawlOptions = z.object({
  startUrl: z.string().url(),
  maxDepth: z.number().int().min(0).max(20).default(3),
  maxPages: z.number().int().min(1).max(2000).default(50),
  sameOriginOnly: z.boolean().default(true),
  /**
   * robots.txt の Disallow / Allow を遵守するか。 default true (安全側)。
   * false にすると robots.txt を無視して全 URL を踏みに行く (Issue #101)。
   */
  respectRobots: z.boolean().default(true),
  navTimeoutMs: z.number().int().min(1000).max(120_000).default(15_000),
  waitAfterNavMs: z.number().int().min(0).max(10_000).default(500),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1280, height: 800 }),
  storageStatePath: z.string().optional(),
  loginScriptPath: z.string().optional(),
  includeUrlPatterns: z.array(z.string()).default([]),
  excludeUrlPatterns: z.array(z.string()).default([]),
  userAgent: z.string().optional(),
});
export type CrawlOptions = z.infer<typeof CrawlOptions>;

export const Run = z.object({
  id: z.string(),
  startUrl: z.string(),
  status: RunStatus,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  options: CrawlOptions,
  errorMessage: z.string().nullable(),
});
export type Run = z.infer<typeof Run>;

export const PageState = z.object({
  id: z.string(),
  runId: z.string(),
  url: z.string(),
  title: z.string(),
  /** URL + DOM 構造ハッシュ。同じ URL でも構造差で別ノード扱い。 */
  signature: z.string(),
  depth: z.number().int().min(0),
  visitedAt: z.string(),
  screenshotPath: z.string().nullable(),
  /** ページ寸法（フルスクリーンショット高さ判定など） */
  viewport: z.object({ width: z.number(), height: z.number() }),
  /** ページ内のエラー数（カウンタ） */
  errorCount: z.number().int().min(0).default(0),
  consoleErrorCount: z.number().int().min(0).default(0),
  networkErrorCount: z.number().int().min(0).default(0),
});
export type PageState = z.infer<typeof PageState>;

export const Edge = z.object({
  id: z.string(),
  runId: z.string(),
  fromPageStateId: z.string(),
  toPageStateId: z.string(),
  trigger: NavigationTrigger,
  /** クリック元セレクタなど */
  triggerSelector: z.string().nullable(),
  triggerText: z.string().nullable(),
  createdAt: z.string(),
});
export type Edge = z.infer<typeof Edge>;

export const ConsoleEntry = z.object({
  id: z.string(),
  pageStateId: z.string(),
  level: z.enum(['log', 'info', 'warn', 'error', 'debug']),
  text: z.string(),
  url: z.string().nullable(),
  lineNumber: z.number().int().nullable(),
  timestamp: z.string(),
});
export type ConsoleEntry = z.infer<typeof ConsoleEntry>;

export const NetworkEntry = z.object({
  id: z.string(),
  pageStateId: z.string(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  statusText: z.string().nullable(),
  resourceType: z.string(),
  startedAt: z.string(),
  durationMs: z.number().nullable(),
  fromCache: z.boolean(),
  failed: z.boolean(),
  failureText: z.string().nullable(),
});
export type NetworkEntry = z.infer<typeof NetworkEntry>;

export const PageError = z.object({
  id: z.string(),
  pageStateId: z.string(),
  kind: z.enum(['pageerror', 'unhandledrejection', 'crash']),
  message: z.string(),
  stack: z.string().nullable(),
  timestamp: z.string(),
});
export type PageError = z.infer<typeof PageError>;

export const RunSummary = z.object({
  run: Run,
  pageCount: z.number().int(),
  edgeCount: z.number().int(),
  errorCount: z.number().int(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const GraphPayload = z.object({
  run: Run,
  pages: z.array(PageState),
  edges: z.array(Edge),
});
export type GraphPayload = z.infer<typeof GraphPayload>;

export const PageDetail = z.object({
  page: PageState,
  console: z.array(ConsoleEntry),
  network: z.array(NetworkEntry),
  errors: z.array(PageError),
  incoming: z.array(Edge),
  outgoing: z.array(Edge),
});
export type PageDetail = z.infer<typeof PageDetail>;

/**
 * 2 つの run の diff (Issue #85 / Intent #125)。
 *
 * page の identity は signature (URL + DOM 構造ハッシュ) を使う。 同じ signature が
 * base / target 両方にあれば「同一画面」、 片方にしかなければ新規 / 削除。
 *
 * errors はメッセージ + stack の fingerprint で別途 diff (errors grouped 側で
 * 計算した fingerprint と互換)。
 */
export const RunDiffPage = z.object({
  pageStateId: z.string(),
  url: z.string(),
  title: z.string(),
  signature: z.string(),
  depth: z.number().int(),
  errorCount: z.number().int(),
  consoleErrorCount: z.number().int(),
  networkErrorCount: z.number().int(),
});
export type RunDiffPage = z.infer<typeof RunDiffPage>;

export const RunDiff = z.object({
  baseRunId: z.string(),
  targetRunId: z.string(),
  /** target にあり base に無い signature の page (= 新規ページ)。 */
  newPages: z.array(RunDiffPage),
  /** base にあり target に無い signature の page (= 削除された / 到達不能になった)。 */
  removedPages: z.array(RunDiffPage),
  /** 両方にある signature の page。 target 側の最新メタを返す。 */
  commonPages: z.array(RunDiffPage),
  summary: z.object({
    baseTotal: z.number().int(),
    targetTotal: z.number().int(),
    newCount: z.number().int(),
    removedCount: z.number().int(),
    commonCount: z.number().int(),
  }),
});
export type RunDiff = z.infer<typeof RunDiff>;
