import { describe, expect, it } from 'vitest';
import { CrawlOptions } from '@testworker/shared';
import {
  evaluateSafetyCaps,
  evaluateStopConditions,
  urlMatchesStopPattern,
  type StopMetrics,
} from './stop-conditions.js';

const baseMetrics: StopMetrics = {
  elapsedMs: 0,
  nextDepth: 0,
  pageCount: 0,
  pageErrorCount: 0,
  networkFailCount: 0,
  screenshotCount: 0,
  stableSteps: 0,
  currentUrl: 'https://example.com/',
  selectorFound: false,
};

describe('stop condition evaluator', () => {
  it('stops when a time budget is exhausted', () => {
    expect(
      evaluateStopConditions(
        { maxDurationSec: 2, combine: 'any' },
        { ...baseMetrics, elapsedMs: 2000 },
      ),
    ).toMatchObject({ shouldStop: true, reason: 'max_duration' });
  });

  it('stops when cumulative page errors reach the budget', () => {
    expect(
      evaluateStopConditions(
        { maxErrors: 3, combine: 'any' },
        { ...baseMetrics, pageErrorCount: 3 },
      ),
    ).toMatchObject({ shouldStop: true, reason: 'max_errors' });
  });

  it('stops when network failures reach the budget', () => {
    expect(
      evaluateStopConditions(
        { maxNetworkFails: 2, combine: 'any' },
        { ...baseMetrics, networkFailCount: 2 },
      ),
    ).toMatchObject({ shouldStop: true, reason: 'max_network_fails' });
  });

  it('stops after a stable plateau', () => {
    expect(
      evaluateStopConditions({ stableForN: 2, combine: 'any' }, { ...baseMetrics, stableSteps: 2 }),
    ).toMatchObject({ shouldStop: true, reason: 'stable_plateau' });
  });

  it('stops when a URL goal matches path, glob, or regex', () => {
    expect(
      evaluateStopConditions(
        { untilUrl: '/dashboard', combine: 'any' },
        { ...baseMetrics, currentUrl: 'https://example.com/app/dashboard?tab=home' },
      ).reason,
    ).toBe('reached_url');
    expect(urlMatchesStopPattern('https://example.com/admin/users', '**/users')).toBe(true);
    expect(urlMatchesStopPattern('https://example.com/admin/users', '/admin\\/users$/')).toBe(true);
  });

  it('stops when a selector goal has been observed', () => {
    expect(
      evaluateStopConditions(
        { untilSelector: '[data-testid="dashboard"]', combine: 'any' },
        { ...baseMetrics, selectorFound: true },
      ),
    ).toMatchObject({ shouldStop: true, reason: 'reached_selector' });
  });

  it('supports all semantics across active conditions', () => {
    expect(
      evaluateStopConditions(
        { maxErrors: 1, maxNetworkFails: 1, combine: 'all' },
        { ...baseMetrics, pageErrorCount: 1, networkFailCount: 0 },
      ).shouldStop,
    ).toBe(false);
    expect(
      evaluateStopConditions(
        { maxErrors: 1, maxNetworkFails: 1, combine: 'all' },
        { ...baseMetrics, pageErrorCount: 1, networkFailCount: 1 },
      ),
    ).toMatchObject({ shouldStop: true, reason: 'max_errors' });
  });

  it('keeps max depth and max pages as safety caps', () => {
    const options = CrawlOptions.parse({
      startUrl: 'https://example.com',
      maxDepth: 1,
      maxPages: 2,
    });
    expect(evaluateSafetyCaps(options, { ...baseMetrics, nextDepth: 2 }).reason).toBe('max_depth');
    expect(evaluateSafetyCaps(options, { ...baseMetrics, pageCount: 2 }).reason).toBe('max_pages');
  });
});
