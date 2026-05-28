import { describe, expect, it } from 'vitest';
import { resolveDeviceProfile } from './devices.js';

const BASE = {
  viewport: { width: 1280, height: 800 },
  userAgent: undefined as string | undefined,
};

describe('resolveDeviceProfile', () => {
  it('desktop プロファイルは viewport / userAgent を passthrough し DSF/mobile/touch は未指定', () => {
    const r = resolveDeviceProfile({ deviceProfile: 'desktop', ...BASE });
    expect(r.viewport).toEqual({ width: 1280, height: 800 });
    expect(r.userAgent).toBeUndefined();
    expect(r.deviceScaleFactor).toBeUndefined();
    expect(r.isMobile).toBeUndefined();
    expect(r.hasTouch).toBeUndefined();
  });

  it('desktop は明示 userAgent をそのまま通す', () => {
    const r = resolveDeviceProfile({
      deviceProfile: 'desktop',
      viewport: { width: 1024, height: 768 },
      userAgent: 'custom-ua',
    });
    expect(r.viewport).toEqual({ width: 1024, height: 768 });
    expect(r.userAgent).toBe('custom-ua');
  });

  it('iphone-14 は viewport / UA / DSF / mobile / touch を preset で上書きする', () => {
    const r = resolveDeviceProfile({ deviceProfile: 'iphone-14', ...BASE });
    expect(r.viewport).toEqual({ width: 390, height: 844 });
    expect(r.userAgent).toContain('iPhone');
    expect(r.deviceScaleFactor).toBe(3);
    expect(r.isMobile).toBe(true);
    expect(r.hasTouch).toBe(true);
  });

  it('非 default profile は明示 userAgent より preset UA を優先する', () => {
    const r = resolveDeviceProfile({
      deviceProfile: 'pixel-7',
      viewport: { width: 1280, height: 800 },
      userAgent: 'custom-ua',
    });
    expect(r.userAgent).toContain('Pixel 7');
    expect(r.viewport).toEqual({ width: 412, height: 839 });
  });

  it('ipad-mini の preset を解決できる', () => {
    const r = resolveDeviceProfile({ deviceProfile: 'ipad-mini', ...BASE });
    expect(r.viewport).toEqual({ width: 768, height: 1024 });
    expect(r.deviceScaleFactor).toBe(2);
    expect(r.isMobile).toBe(true);
  });
});
