import type { CrawlOptions, RunStoppedReason, StopConditions } from '@testworker/shared';

export interface StopMetrics {
  elapsedMs: number;
  nextDepth: number | null;
  pageCount: number;
  pageErrorCount: number;
  networkFailCount: number;
  screenshotCount: number;
  stableSteps: number;
  currentUrl: string | null;
  selectorFound: boolean;
}

export interface StopEvaluation {
  shouldStop: boolean;
  reason: RunStoppedReason | null;
  matched: RunStoppedReason[];
}

const ORDER: RunStoppedReason[] = [
  'max_duration',
  'max_errors',
  'max_network_fails',
  'stable_plateau',
  'reached_url',
  'reached_selector',
  'max_screenshots',
  'max_depth',
  'max_pages',
];

export function evaluateSafetyCaps(options: CrawlOptions, metrics: StopMetrics): StopEvaluation {
  const matched: RunStoppedReason[] = [];
  if (metrics.nextDepth !== null && metrics.nextDepth > options.maxDepth) matched.push('max_depth');
  if (metrics.pageCount >= options.maxPages) matched.push('max_pages');
  return resultForMatched(matched, 'any');
}

export function evaluateStopConditions(
  conditions: StopConditions,
  metrics: StopMetrics,
): StopEvaluation {
  const active = activeReasons(conditions);
  if (active.length === 0) return { shouldStop: false, reason: null, matched: [] };

  const matched = active.filter((reason) => conditionMet(reason, conditions, metrics));
  const shouldStop =
    conditions.combine === 'all' ? matched.length === active.length : matched.length > 0;
  return {
    shouldStop,
    reason: shouldStop ? firstReason(matched) : null,
    matched,
  };
}

function activeReasons(conditions: StopConditions): RunStoppedReason[] {
  const active: RunStoppedReason[] = [];
  if (conditions.maxDurationSec != null) active.push('max_duration');
  if (conditions.maxErrors != null) active.push('max_errors');
  if (conditions.maxNetworkFails != null) active.push('max_network_fails');
  if (conditions.stableForN != null) active.push('stable_plateau');
  if (conditions.untilUrl != null) active.push('reached_url');
  if (conditions.untilSelector != null) active.push('reached_selector');
  if (conditions.maxScreenshots != null) active.push('max_screenshots');
  if (conditions.maxDepth != null) active.push('max_depth');
  if (conditions.maxPages != null) active.push('max_pages');
  return active;
}

function conditionMet(
  reason: RunStoppedReason,
  conditions: StopConditions,
  metrics: StopMetrics,
): boolean {
  switch (reason) {
    case 'max_duration':
      return metrics.elapsedMs >= (conditions.maxDurationSec ?? Number.POSITIVE_INFINITY) * 1000;
    case 'max_errors':
      return metrics.pageErrorCount >= (conditions.maxErrors ?? Number.POSITIVE_INFINITY);
    case 'max_network_fails':
      return metrics.networkFailCount >= (conditions.maxNetworkFails ?? Number.POSITIVE_INFINITY);
    case 'stable_plateau':
      return metrics.stableSteps >= (conditions.stableForN ?? Number.POSITIVE_INFINITY);
    case 'reached_url':
      return metrics.currentUrl
        ? urlMatchesStopPattern(metrics.currentUrl, conditions.untilUrl)
        : false;
    case 'reached_selector':
      return metrics.selectorFound;
    case 'max_screenshots':
      return metrics.screenshotCount >= (conditions.maxScreenshots ?? Number.POSITIVE_INFINITY);
    case 'max_depth':
      return (
        metrics.nextDepth !== null &&
        metrics.nextDepth > (conditions.maxDepth ?? Number.POSITIVE_INFINITY)
      );
    case 'max_pages':
      return metrics.pageCount >= (conditions.maxPages ?? Number.POSITIVE_INFINITY);
    default:
      return false;
  }
}

export function urlMatchesStopPattern(url: string, pattern: string | undefined): boolean {
  if (!pattern) return false;
  const candidates = urlCandidates(url);
  const regex = regexFromPattern(pattern);
  if (regex) return candidates.some((candidate) => regex.test(candidate));
  return candidates.some((candidate) => candidate.includes(pattern));
}

function urlCandidates(url: string): string[] {
  try {
    const parsed = new URL(url);
    return [
      url,
      parsed.pathname,
      `${parsed.pathname}${parsed.search}`,
      `${parsed.pathname}${parsed.search}${parsed.hash}`,
    ];
  } catch {
    return [url];
  }
}

function regexFromPattern(pattern: string): RegExp | null {
  if (pattern.startsWith('/') && pattern.lastIndexOf('/') > 0) {
    const last = pattern.lastIndexOf('/');
    try {
      return new RegExp(pattern.slice(1, last), pattern.slice(last + 1));
    } catch {
      return null;
    }
  }
  if (pattern.includes('*')) {
    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`);
  }
  return null;
}

function resultForMatched(
  matched: RunStoppedReason[],
  combine: StopConditions['combine'],
): StopEvaluation {
  return {
    shouldStop: combine === 'all' ? matched.length > 0 : matched.length > 0,
    reason: matched.length > 0 ? firstReason(matched) : null,
    matched,
  };
}

function firstReason(matched: RunStoppedReason[]): RunStoppedReason | null {
  return ORDER.find((reason) => matched.includes(reason)) ?? matched[0] ?? null;
}
