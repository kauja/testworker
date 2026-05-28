import type { Page } from 'playwright';
import { log, type NetworkThrottlePreset } from '@testworker/shared';

/**
 * Network / CPU throttling を CDP 経由で適用する (Issue #197)。
 *
 * Playwright 自体には throttling API が無いため、 page.context().newCDPSession()
 * で Chrome DevTools Protocol を直接叩く。
 *  - Network.emulateNetworkConditions  : 帯域 / RTT / offline を制御
 *  - Emulation.setCPUThrottlingRate    : CPU を rate 分の 1 に減速
 *
 * 副作用 (CDP session) は crawl/ 配下に閉じる。 適用は context ではなく page 単位
 * (CDP session が page にひも付くため)。 throttling 不要なら CDP を一切呼ばない。
 */

/** CDP Network.emulateNetworkConditions に渡すパラメータ。 */
interface NetworkConditions {
  offline: boolean;
  /** bytes/sec。 -1 で無制限。 */
  downloadThroughput: number;
  uploadThroughput: number;
  /** ms。 */
  latency: number;
}

const KBPS = 1024 / 8; // 1 kbit/s を bytes/s に変換する係数

/**
 * CDP の標準的な 3G プリセット値。 Chrome DevTools の "Slow 3G" / "Fast 3G" と同等。
 * 'none' は networkThrottle の適用自体を skip するので map には入れない。
 */
const NETWORK_PRESETS: Record<Exclude<NetworkThrottlePreset, 'none'>, NetworkConditions> = {
  offline: { offline: true, downloadThroughput: 0, uploadThroughput: 0, latency: 0 },
  'slow-3g': {
    offline: false,
    downloadThroughput: Math.round(500 * KBPS),
    uploadThroughput: Math.round(500 * KBPS),
    latency: 400,
  },
  'fast-3g': {
    offline: false,
    downloadThroughput: Math.round(1.6 * 1024 * KBPS),
    uploadThroughput: Math.round(750 * KBPS),
    latency: 150,
  },
};

export interface ThrottleOptions {
  networkThrottle: NetworkThrottlePreset;
  cpuThrottle: number;
}

/** throttling が 1 つでも有効か (= CDP session を張る必要があるか) を判定。 */
export function needsThrottling(opts: ThrottleOptions): boolean {
  return opts.networkThrottle !== 'none' || opts.cpuThrottle > 1;
}

/** preset 名から CDP conditions を引く。 'none' は null (適用 skip)。 */
export function resolveNetworkConditions(preset: NetworkThrottlePreset): NetworkConditions | null {
  if (preset === 'none') return null;
  return NETWORK_PRESETS[preset];
}

export async function applyThrottling(page: Page, opts: ThrottleOptions): Promise<void> {
  if (!needsThrottling(opts)) return;
  const session = await page.context().newCDPSession(page);
  const conditions = resolveNetworkConditions(opts.networkThrottle);
  if (conditions) {
    await session.send('Network.emulateNetworkConditions', conditions);
  }
  if (opts.cpuThrottle > 1) {
    await session.send('Emulation.setCPUThrottlingRate', { rate: opts.cpuThrottle });
  }
  log.info(
    { networkThrottle: opts.networkThrottle, cpuThrottle: opts.cpuThrottle },
    'throttling applied',
  );
}
