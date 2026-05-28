import type { CrawlOptions, DeviceProfile } from '@testworker/shared';

/**
 * Device / Viewport プリセット解決 (Issue #196)。
 *
 * Playwright の `devices` テーブルを import すると unit test が Playwright を
 * 引き込むため、 必要な数個の named preset を module-level の const map に
 * ハンドロールする (CLAUDE.md「module-level 定数を先頭で宣言」)。
 *
 * `desktop` (default) は preset を持たず passthrough = 既存 `options.viewport` /
 * `options.userAgent` をそのまま使う。 これにより旧 run の再 parse がバイト一致し、
 * 後方互換を保つ。 非 default profile は viewport / userAgent / deviceScaleFactor /
 * isMobile / hasTouch を上書きする。
 */

export interface DevicePreset {
  viewport: { width: number; height: number };
  userAgent: string;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

/** Playwright newContext に渡す解決済みのコンテキストパラメータ。 */
export interface ResolvedDevice {
  viewport: { width: number; height: number };
  userAgent: string | undefined;
  deviceScaleFactor: number | undefined;
  isMobile: boolean | undefined;
  hasTouch: boolean | undefined;
}

/**
 * 非 default profile の preset。 値は Playwright の devices テーブルの代表機種に
 * 準拠した近似 (viewport / UA / DSF)。 `desktop` は passthrough なので map に持たない。
 */
const DEVICE_PRESETS: Record<Exclude<DeviceProfile, 'desktop'>, DevicePreset> = {
  'iphone-14': {
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  },
  'pixel-7': {
    viewport: { width: 412, height: 839 },
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Mobile Safari/537.36',
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
  },
  'ipad-mini': {
    viewport: { width: 768, height: 1024 },
    userAgent:
      'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1',
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  },
};

/**
 * deviceProfile を解決して newContext 用のパラメータを返す純粋関数。
 * - `desktop`: passthrough。 viewport は options.viewport、 userAgent は options.userAgent。
 *   deviceScaleFactor / isMobile / hasTouch は undefined (Playwright default)。
 * - それ以外: preset の viewport / userAgent / DSF / mobile / touch で上書きする。
 *
 * options.userAgent が明示されていても profile による UA 上書きを優先する
 * (profile を選んだ意図 = その端末になりきる、を尊重)。
 */
export function resolveDeviceProfile(
  options: Pick<CrawlOptions, 'deviceProfile' | 'viewport' | 'userAgent'>,
): ResolvedDevice {
  if (options.deviceProfile === 'desktop') {
    return {
      viewport: options.viewport,
      userAgent: options.userAgent,
      deviceScaleFactor: undefined,
      isMobile: undefined,
      hasTouch: undefined,
    };
  }
  const preset = DEVICE_PRESETS[options.deviceProfile];
  return {
    viewport: preset.viewport,
    userAgent: preset.userAgent,
    deviceScaleFactor: preset.deviceScaleFactor,
    isMobile: preset.isMobile,
    hasTouch: preset.hasTouch,
  };
}
