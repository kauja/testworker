import { describe, expect, it } from 'vitest';
import { buildRunnerCommand } from './run-launcher.js';

describe('buildRunnerCommand', () => {
  it('builds a pnpm runner invocation with bounded crawl options', () => {
    const cmd = buildRunnerCommand({
      startUrl: 'https://example.com',
      maxDepth: 2,
      maxPages: 10,
      sameOriginOnly: true,
      respectRobots: true,
      navTimeoutMs: 20_000,
      waitAfterNavMs: 250,
      captureWebVitals: true,
    });

    expect(cmd.command).toBe('pnpm');
    expect(cmd.args).toEqual([
      '--filter',
      '@testworker/runner',
      'run',
      'crawl',
      '--url',
      'https://example.com',
      '--max-depth',
      '2',
      '--max-pages',
      '10',
      '--nav-timeout-ms',
      '20000',
      '--wait-after-nav-ms',
      '250',
    ]);
    expect(cmd.env.START_URL).toBe('https://example.com');
    expect(cmd.env.SAME_ORIGIN_ONLY).toBe('true');
  });

  it('passes explicit opt-outs to the runner CLI', () => {
    const cmd = buildRunnerCommand({
      startUrl: 'https://example.com',
      maxDepth: 0,
      maxPages: 1,
      sameOriginOnly: false,
      respectRobots: false,
      navTimeoutMs: 1000,
      waitAfterNavMs: 0,
      captureWebVitals: false,
    });

    expect(cmd.args).toContain('--no-same-origin');
    expect(cmd.args).toContain('--no-respect-robots');
    expect(cmd.args).toContain('--no-web-vitals');
    expect(cmd.env.RESPECT_ROBOTS).toBe('false');
  });
});
