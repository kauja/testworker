import { z } from 'zod';

export const RunStatus = z.enum(['queued', 'running', 'completed', 'failed', 'canceled']);
export type RunStatus = z.infer<typeof RunStatus>;

/**
 * page.goto の waitUntil に渡す navigation 完了判定 (Issue #200)。
 * - load: load イベントまで待つ (従来の挙動)
 * - domcontentloaded: DOMContentLoaded まで (最速、 sub-resource を待たない)
 * - networkidle: ネットワークが落ち着くまで (SPA / 遅延ロード向け、 最も遅い)
 */
export const WaitStrategy = z.enum(['load', 'domcontentloaded', 'networkidle']);
export type WaitStrategy = z.infer<typeof WaitStrategy>;

/**
 * Network throttling のプリセット (Issue #197)。 CDP の Network.emulateNetworkConditions
 * に展開する。 'none' は throttling 無効 (= CDP を呼ばない)。
 */
export const NetworkThrottlePreset = z.enum(['none', 'offline', 'slow-3g', 'fast-3g']);
export type NetworkThrottlePreset = z.infer<typeof NetworkThrottlePreset>;

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

/**
 * Device / Viewport プリセット (Issue #196)。 named preset から viewport / userAgent /
 * deviceScaleFactor を解決して Playwright context に渡す。
 * `desktop` (default) は完全 passthrough = 既存 `viewport` / `userAgent` をそのまま使い、
 * 旧 run との後方互換を保つ。 それ以外の profile は viewport / UA / DSF を上書きする。
 */
export const DeviceProfile = z.enum(['desktop', 'iphone-14', 'pixel-7', 'ipad-mini']);
export type DeviceProfile = z.infer<typeof DeviceProfile>;

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
  /**
   * page.goto の waitUntil。 default 'load' で従来挙動を維持 (後方互換)。
   * networkidle は navTimeoutMs を超えやすいので timeout と整合させて使う。
   */
  waitStrategy: WaitStrategy.default('load'),
  viewport: z
    .object({ width: z.number().int().positive(), height: z.number().int().positive() })
    .default({ width: 1280, height: 800 }),
  storageStatePath: z.string().optional(),
  loginScriptPath: z.string().optional(),
  /**
   * 各ページ評価前に `context.addInitScript` で注入する JS/TS ファイルのパス (Issue #203)。
   * loginScript と違い動的 import せず、 ファイル内容を文字列として addInitScript に渡す
   * (=ブラウザのページコンテキストで実行、 Node ホストでは実行しない)。 absent = 注入なし
   * (storageStatePath / loginScriptPath と同様 optional で後方互換)。
   * 秘密値 (token / password 等) はクライアントに露出するためここに注入しないこと。
   */
  injectScriptPath: z.string().optional(),
  includeUrlPatterns: z.array(z.string()).default([]),
  excludeUrlPatterns: z.array(z.string()).default([]),
  userAgent: z.string().optional(),
  captureWebVitals: z.boolean().default(true),
  /**
   * 各ページ訪問後に段階的に scrollBy して infinite scroll / lazy load を発火させるか (Issue #199)。
   * default false (既存 run の挙動を変えない / 後方互換)。 true にすると signature 計算前に
   * autoScrollMaxSteps 回まで下方向スクロールし、 毎ステップ autoScrollDelayMs 待つ。
   * ページ最下部に到達するか、 スクロール高さが伸びなくなったら早期終了する。
   */
  autoScroll: z.boolean().default(false),
  /** autoScroll 有効時の最大スクロールステップ数。 default 10 (上限 100)。 */
  autoScrollMaxSteps: z.number().int().min(1).max(100).default(10),
  /** autoScroll の各ステップ後の待機 (lazy load の発火待ち)。 default 400ms (上限 10s)。 */
  autoScrollDelayMs: z.number().int().min(0).max(10_000).default(400),
  /**
   * クロール中に abort する resourceType の配列 (Issue #202)。 Playwright の
   * `request.resourceType()` と完全一致でブロック (例: `font` / `image` / `media`)。
   * default [] = ブロック無し (既存 run と完全後方互換)。
   */
  blockResourceTypes: z.array(z.string()).default([]),
  /**
   * クロール中に abort する URL の正規表現文字列配列 (Issue #202)。 analytics / ads は
   * resourceType で括れない (script / xhr / fetch として読み込まれる) ため、 ドメインを
   * パターンで弾く。 `includeUrlPatterns` と同じく `new RegExp(p).test(url)` で評価。
   * default [] = ブロック無し。
   */
  blockUrlPatterns: z.array(z.string()).default([]),
  /**
   * Issue #205: HTTP キャッシュ制御。 `warm` (既定) はブラウザ既定の Cache-Control 挙動。
   * `disabled` は CDP Network.setCacheDisabled で全リクエストをキャッシュ無視。
   * `cold` は開始前にブラウザキャッシュ + Cookie をクリアしてから disabled と同じ扱い。
   * 旧 run (フィールド追加前) は default の warm として解釈される。
   */
  cacheMode: z.enum(['cold', 'warm', 'disabled']).default('warm'),
  /**
   * Network throttling プリセット (Issue #197)。 default 'none' (絞らない)。
   * 'offline' は完全オフライン、 'slow-3g' / 'fast-3g' は CDP の標準値で帯域 / RTT を制限。
   */
  networkThrottle: NetworkThrottlePreset.default('none'),
  /**
   * CPU throttling 倍率 (Issue #197)。 1 = 絞らない (default)、 4 = 1/4 の速度。
   * CDP の Emulation.setCPUThrottlingRate に渡す。 1 のときは CDP を呼ばない。
   */
  cpuThrottle: z.number().min(1).max(20).default(1),
  /**
   * Device / Viewport プリセット (Issue #196)。 default `desktop` は passthrough で
   * 既存挙動を維持。 非 default の profile は viewport / userAgent / deviceScaleFactor を
   * 上書きする (実 viewport は runner 側の resolveDeviceProfile が決定)。
   */
  deviceProfile: DeviceProfile.default('desktop'),
});
export type CrawlOptions = z.infer<typeof CrawlOptions>;

export const RunLaunchInput = CrawlOptions.pick({
  startUrl: true,
  maxDepth: true,
  maxPages: true,
  sameOriginOnly: true,
  respectRobots: true,
  navTimeoutMs: true,
  waitAfterNavMs: true,
  viewport: true,
  includeUrlPatterns: true,
  excludeUrlPatterns: true,
  userAgent: true,
  captureWebVitals: true,
});
export type RunLaunchInput = z.infer<typeof RunLaunchInput>;

export const RunLaunchResponse = z.object({
  accepted: z.literal(true),
  acceptedAt: z.string(),
  options: RunLaunchInput,
});
export type RunLaunchResponse = z.infer<typeof RunLaunchResponse>;

export const Run = z.object({
  id: z.string(),
  startUrl: z.string(),
  status: RunStatus,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  options: CrawlOptions,
  errorMessage: z.string().nullable(),
  /**
   * 走行中の進捗 (Issue #86)。 runner が BFS ループで定期更新する。
   * 旧 run (column 追加前) は default で 0 / null になる。
   */
  pagesDone: z.number().int().min(0).default(0),
  queueSize: z.number().int().min(0).nullable().default(null),
  currentUrl: z.string().nullable().default(null),
  /**
   * Playwright `recordHar` で記録した HAR ファイルへのパス (Issue #87)。
   * DATA_DIR からの相対パス。 旧 run / 失敗 run / mode:'minimal' を切った run は null。
   */
  harPath: z.string().nullable().default(null),
});
export type Run = z.infer<typeof Run>;

export const PageMetrics = z.object({
  lcp: z.number().nonnegative().nullable().optional(),
  cls: z.number().nonnegative().nullable().optional(),
  inp: z.number().nonnegative().nullable().optional(),
  ttfb: z.number().nonnegative().nullable().optional(),
  fcp: z.number().nonnegative().nullable().optional(),
});
export type PageMetrics = z.infer<typeof PageMetrics>;

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
  metrics: PageMetrics.default({}),
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
 * 同 run 内で同じスタックトレース / メッセージのエラーを横串集約した単位 (Issue #88)。
 * count は「踏んだページ件数」 (= 集約された pageError 行数)。
 */
export const ErrorGroup = z.object({
  /** message + normalized stack の hash。 同一 group の安定 ID として使う。 */
  fingerprint: z.string(),
  kind: z.enum(['pageerror', 'unhandledrejection', 'crash']),
  message: z.string(),
  /** group 内代表 stack (= 最初に出現したもの)。 normalize 前。 */
  stack: z.string().nullable(),
  count: z.number().int().min(1),
  /** このグループのエラーを踏んだページ群 (最大 10 件)。 */
  samplePages: z.array(
    z.object({
      pageStateId: z.string(),
      url: z.string(),
      title: z.string(),
    }),
  ),
});
export type ErrorGroup = z.infer<typeof ErrorGroup>;

const ErrorPageRef = z.object({
  pageStateId: z.string(),
  url: z.string(),
  title: z.string(),
});
export type ErrorPageRef = z.infer<typeof ErrorPageRef>;

export const RunConsoleError = ConsoleEntry.extend({
  page: ErrorPageRef,
});
export type RunConsoleError = z.infer<typeof RunConsoleError>;

export const RunNetworkError = NetworkEntry.extend({
  page: ErrorPageRef,
});
export type RunNetworkError = z.infer<typeof RunNetworkError>;

export const RunErrorsPayload = z.object({
  runId: z.string(),
  totals: z.object({
    pageErrors: z.number().int().min(0),
    consoleErrors: z.number().int().min(0),
    networkErrors: z.number().int().min(0),
    all: z.number().int().min(0),
  }),
  pageErrorGroups: z.array(ErrorGroup),
  consoleErrors: z.array(RunConsoleError),
  networkErrors: z.array(RunNetworkError),
});
export type RunErrorsPayload = z.infer<typeof RunErrorsPayload>;

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
