import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import { CrawlOptions } from '@testworker/shared';
import { applyCacheMode, cacheDisabledFlag, needsColdReset } from './cache.js';

describe('cacheMode schema', () => {
  it('defaults to warm when omitted (後方互換)', () => {
    const opts = CrawlOptions.parse({ startUrl: 'https://example.com' });
    expect(opts.cacheMode).toBe('warm');
  });

  it('accepts cold / warm / disabled', () => {
    for (const mode of ['cold', 'warm', 'disabled'] as const) {
      const opts = CrawlOptions.parse({ startUrl: 'https://example.com', cacheMode: mode });
      expect(opts.cacheMode).toBe(mode);
    }
  });

  it('rejects unknown cacheMode', () => {
    const r = CrawlOptions.safeParse({ startUrl: 'https://example.com', cacheMode: 'bogus' });
    expect(r.success).toBe(false);
  });
});

describe('cacheDisabledFlag / needsColdReset', () => {
  it('warm keeps cache enabled', () => {
    expect(cacheDisabledFlag('warm')).toBe(false);
    expect(needsColdReset('warm')).toBe(false);
  });
  it('disabled turns cache off without cold reset', () => {
    expect(cacheDisabledFlag('disabled')).toBe(true);
    expect(needsColdReset('disabled')).toBe(false);
  });
  it('cold turns cache off and requires reset', () => {
    expect(cacheDisabledFlag('cold')).toBe(true);
    expect(needsColdReset('cold')).toBe(true);
  });
});

function makeMocks() {
  const send = vi.fn().mockResolvedValue(undefined);
  const newCDPSession = vi.fn().mockResolvedValue({ send });
  const clearCookies = vi.fn().mockResolvedValue(undefined);
  const context = { newCDPSession, clearCookies } as unknown as BrowserContext;
  const page = {} as Page;
  return { send, newCDPSession, clearCookies, context, page };
}

describe('applyCacheMode', () => {
  it('warm is a no-op (no CDP session opened)', async () => {
    const { context, page, newCDPSession } = makeMocks();
    await applyCacheMode(context, page, 'warm');
    expect(newCDPSession).not.toHaveBeenCalled();
  });

  it('disabled sets Network.setCacheDisabled true without clearing', async () => {
    const { context, page, send, clearCookies } = makeMocks();
    await applyCacheMode(context, page, 'disabled');
    expect(clearCookies).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('Network.setCacheDisabled', { cacheDisabled: true });
    expect(send).not.toHaveBeenCalledWith('Network.clearBrowserCache');
  });

  it('cold clears browser cache + cookies then disables cache', async () => {
    const { context, page, send, clearCookies } = makeMocks();
    await applyCacheMode(context, page, 'cold');
    expect(send).toHaveBeenCalledWith('Network.clearBrowserCache');
    expect(clearCookies).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith('Network.setCacheDisabled', { cacheDisabled: true });
  });
});
