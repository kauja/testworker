import { describe, expect, it } from 'vitest';
import { CrawlOptions, Run } from './schema.js';

describe('CrawlOptions', () => {
  it('applies defaults to the minimal valid input', () => {
    expect(CrawlOptions.parse({ startUrl: 'https://example.com' })).toEqual({
      startUrl: 'https://example.com',
      maxDepth: 3,
      maxPages: 50,
      sameOriginOnly: true,
      respectRobots: true,
      navTimeoutMs: 15_000,
      waitAfterNavMs: 500,
      waitStrategy: 'load',
      viewport: { width: 1280, height: 800 },
      includeUrlPatterns: [],
      excludeUrlPatterns: [],
      captureWebVitals: true,
      autoScroll: false,
      autoScrollMaxSteps: 10,
      autoScrollDelayMs: 400,
      blockResourceTypes: [],
      blockUrlPatterns: [],
      cacheMode: 'warm',
      networkThrottle: 'none',
      cpuThrottle: 1,
      deviceProfile: 'desktop',
    });
  });

  it('rejects values outside crawl safety bounds', () => {
    expect(() => CrawlOptions.parse({ startUrl: 'https://example.com', maxPages: 0 })).toThrow();
    expect(() => CrawlOptions.parse({ startUrl: 'https://example.com', maxDepth: 21 })).toThrow();
    expect(() =>
      CrawlOptions.parse({ startUrl: 'https://example.com', navTimeoutMs: 999 }),
    ).toThrow();
  });
});

describe('Run', () => {
  it('parses a legacy-compatible row payload with defaulted options', () => {
    expect(
      Run.parse({
        id: 'run_1',
        startUrl: 'https://example.com',
        status: 'completed',
        startedAt: '2026-01-01T00:00:00.000Z',
        finishedAt: null,
        options: { startUrl: 'https://example.com' },
        errorMessage: null,
      }),
    ).toMatchObject({
      id: 'run_1',
      options: {
        startUrl: 'https://example.com',
        maxDepth: 3,
        maxPages: 50,
        respectRobots: true,
      },
    });
  });
});
