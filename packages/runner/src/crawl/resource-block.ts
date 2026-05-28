/**
 * リソースブロック (Issue #202)。
 *
 * クロール中に不要なリソースを `context.route` で abort し、 巡回の安定性 / 速度 /
 * ノイズ低減に寄与する。 2 軸で判定する:
 *
 *   1. resourceType ベース (`blockResourceTypes`) — Playwright の `request.resourceType()`
 *      と完全一致でブロック。 `font` / `image` / `media` など型で括れるものに有効。
 *   2. URL パターンベース (`blockUrlPatterns`) — 正規表現文字列。 `includeUrlPatterns` と
 *      同じく `new RegExp(p).test(url)` で評価。 analytics / ads は型では括れず
 *      (`script` / `xhr` / `fetch` / `ping` として読み込まれる) ドメインで弾く必要がある。
 *
 * 既定のブロックリストは「拡張可能なスターター」。 網羅性は load-bearing ではないので
 * 代表的なドメインだけ並べ、 利用側が `blockUrlPatterns` で足せる前提。
 */
import type { BrowserContext } from 'playwright';

/** abort 理由。 net::ERR_BLOCKED_BY_CLIENT として requestfailed に現れ、 monitor 側で除外する。 */
export const BLOCK_ABORT_REASON = 'blockedbyclient';
/** monitor が「意図的ブロック」を network エラーから除外するための errorText シグネチャ。 */
export const BLOCKED_BY_CLIENT_ERROR = 'net::ERR_BLOCKED_BY_CLIENT';

/** analytics / 計測系の代表ドメイン (正規表現文字列)。 */
export const DEFAULT_ANALYTICS_PATTERNS: readonly string[] = [
  'google-analytics\\.com',
  'googletagmanager\\.com',
  'analytics\\.google\\.com',
  'stats\\.g\\.doubleclick\\.net',
  'segment\\.(io|com)',
  'mixpanel\\.com',
  'amplitude\\.com',
  'hotjar\\.com',
  'fullstory\\.com',
];

/** 広告系の代表ドメイン (正規表現文字列)。 */
export const DEFAULT_ADS_PATTERNS: readonly string[] = [
  'doubleclick\\.net',
  'googlesyndication\\.com',
  'googleadservices\\.com',
  'adservice\\.google\\.',
  'adnxs\\.com',
  'amazon-adsystem\\.com',
  'taboola\\.com',
  'outbrain\\.com',
  'criteo\\.(com|net)',
  'scorecardresearch\\.com',
];

/** フォント系の resourceType (Playwright の `font`)。 */
export const DEFAULT_FONT_RESOURCE_TYPES: readonly string[] = ['font'];

/** CLI `--block <preset>` で選べるプリセット名。 */
export const BLOCK_PRESETS = ['analytics', 'ads', 'fonts'] as const;
export type BlockPreset = (typeof BLOCK_PRESETS)[number];

export interface ResourceBlockExpansion {
  blockResourceTypes: string[];
  blockUrlPatterns: string[];
}

/**
 * プリセット名の配列を resourceType / URL パターンの 2 配列に展開する。
 * 重複は除去する。 未知のプリセットは無視 (CLI 側で弾く前提だが防御的に)。
 */
export function expandBlockPresets(presets: readonly string[]): ResourceBlockExpansion {
  const resourceTypes = new Set<string>();
  const urlPatterns = new Set<string>();
  for (const preset of presets) {
    switch (preset) {
      case 'analytics':
        for (const p of DEFAULT_ANALYTICS_PATTERNS) urlPatterns.add(p);
        break;
      case 'ads':
        for (const p of DEFAULT_ADS_PATTERNS) urlPatterns.add(p);
        break;
      case 'fonts':
        for (const t of DEFAULT_FONT_RESOURCE_TYPES) resourceTypes.add(t);
        break;
      default:
        break;
    }
  }
  return {
    blockResourceTypes: [...resourceTypes],
    blockUrlPatterns: [...urlPatterns],
  };
}

export interface ResourceBlockOptions {
  blockResourceTypes: readonly string[];
  blockUrlPatterns: readonly string[];
}

/**
 * 与えた resourceType / URL がブロック対象か判定する純粋関数。
 * resourceType の完全一致、 または URL パターンのいずれかにマッチでブロック。
 * 両方空なら常に false (= 既定 run は素通し、 後方互換)。
 */
export function shouldBlock(
  resourceType: string,
  url: string,
  opts: ResourceBlockOptions,
): boolean {
  if (opts.blockResourceTypes.includes(resourceType)) return true;
  for (const pattern of opts.blockUrlPatterns) {
    try {
      if (new RegExp(pattern).test(url)) return true;
    } catch {
      // 不正な正規表現は無視 (skip して fail-open)
    }
  }
  return false;
}

/**
 * `blockResourceTypes` / `blockUrlPatterns` のいずれかが指定されているか。
 * false の場合は route を一切登録しない (既定 run は interception 無し = 完全後方互換)。
 */
export function hasResourceBlocking(opts: ResourceBlockOptions): boolean {
  return opts.blockResourceTypes.length > 0 || opts.blockUrlPatterns.length > 0;
}

/**
 * context に route ハンドラを 1 本登録する。 マッチした request は abort、
 * それ以外は必ず continue (continue を忘れると全 request が hang する)。
 */
export async function installResourceBlocking(
  context: BrowserContext,
  opts: ResourceBlockOptions,
): Promise<void> {
  await context.route('**/*', (route) => {
    const request = route.request();
    if (shouldBlock(request.resourceType(), request.url(), opts)) {
      void route.abort(BLOCK_ABORT_REASON);
      return;
    }
    void route.continue();
  });
}
