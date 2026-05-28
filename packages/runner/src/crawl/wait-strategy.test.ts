import { describe, expect, it } from 'vitest';
import { CrawlOptions, WaitStrategy } from '@testworker/shared';
import { optionsFromEnv } from '../config.js';

const START_URL = 'https://example.com';

describe('waitStrategy option (Issue #200)', () => {
  it('defaults to "load" for backwards compatibility', () => {
    const opts = CrawlOptions.parse({ startUrl: START_URL });
    expect(opts.waitStrategy).toBe('load');
  });

  it('accepts each supported Playwright waitUntil value', () => {
    for (const value of ['load', 'domcontentloaded', 'networkidle'] as const) {
      const opts = CrawlOptions.parse({ startUrl: START_URL, waitStrategy: value });
      expect(opts.waitStrategy).toBe(value);
    }
  });

  it('rejects an unsupported wait strategy', () => {
    expect(() => CrawlOptions.parse({ startUrl: START_URL, waitStrategy: 'commit' })).toThrow();
    expect(WaitStrategy.safeParse('commit').success).toBe(false);
  });

  it('falls back to the schema default in optionsFromEnv when unset', () => {
    expect(optionsFromEnv(START_URL).waitStrategy).toBe('load');
  });
});
