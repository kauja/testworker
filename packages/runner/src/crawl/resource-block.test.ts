import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ADS_PATTERNS,
  DEFAULT_ANALYTICS_PATTERNS,
  expandBlockPresets,
  hasResourceBlocking,
  shouldBlock,
} from './resource-block.js';

describe('shouldBlock', () => {
  it('blocks a font by resourceType', () => {
    expect(
      shouldBlock('font', 'https://example.com/fonts/inter.woff2', {
        blockResourceTypes: ['font'],
        blockUrlPatterns: [],
      }),
    ).toBe(true);
  });

  it('blocks an analytics request by URL pattern even though it is a script', () => {
    expect(
      shouldBlock('script', 'https://www.google-analytics.com/analytics.js', {
        blockResourceTypes: [],
        blockUrlPatterns: DEFAULT_ANALYTICS_PATTERNS,
      }),
    ).toBe(true);
  });

  it('blocks an ads xhr by URL pattern', () => {
    expect(
      shouldBlock('xhr', 'https://securepubads.g.doubleclick.net/gampad/ads', {
        blockResourceTypes: [],
        blockUrlPatterns: DEFAULT_ADS_PATTERNS,
      }),
    ).toBe(true);
  });

  it('passes an ordinary first-party script through', () => {
    expect(
      shouldBlock('script', 'https://example.com/app.js', {
        blockResourceTypes: ['font'],
        blockUrlPatterns: DEFAULT_ANALYTICS_PATTERNS,
      }),
    ).toBe(false);
  });

  it('blocks nothing when both lists are empty (backward compat)', () => {
    expect(
      shouldBlock('font', 'https://www.google-analytics.com/analytics.js', {
        blockResourceTypes: [],
        blockUrlPatterns: [],
      }),
    ).toBe(false);
  });

  it('ignores invalid regex patterns (fail-open) instead of throwing', () => {
    expect(
      shouldBlock('script', 'https://example.com/app.js', {
        blockResourceTypes: [],
        blockUrlPatterns: ['(unclosed'],
      }),
    ).toBe(false);
  });
});

describe('expandBlockPresets', () => {
  it('maps fonts to a resourceType and analytics/ads to URL patterns', () => {
    const out = expandBlockPresets(['fonts', 'analytics', 'ads']);
    expect(out.blockResourceTypes).toEqual(['font']);
    expect(out.blockUrlPatterns).toEqual(
      expect.arrayContaining([...DEFAULT_ANALYTICS_PATTERNS, ...DEFAULT_ADS_PATTERNS]),
    );
  });

  it('dedupes and ignores unknown presets', () => {
    const out = expandBlockPresets(['fonts', 'fonts', 'nope']);
    expect(out.blockResourceTypes).toEqual(['font']);
    expect(out.blockUrlPatterns).toEqual([]);
  });

  it('returns empty arrays for empty input', () => {
    expect(expandBlockPresets([])).toEqual({ blockResourceTypes: [], blockUrlPatterns: [] });
  });
});

describe('hasResourceBlocking', () => {
  it('is false when nothing is configured', () => {
    expect(hasResourceBlocking({ blockResourceTypes: [], blockUrlPatterns: [] })).toBe(false);
  });

  it('is true when a resourceType or URL pattern is set', () => {
    expect(hasResourceBlocking({ blockResourceTypes: ['font'], blockUrlPatterns: [] })).toBe(true);
    expect(hasResourceBlocking({ blockResourceTypes: [], blockUrlPatterns: ['x'] })).toBe(true);
  });
});
