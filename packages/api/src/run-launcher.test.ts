import { describe, expect, it } from 'vitest';
import { buildRunnerCommand } from './run-launcher.js';

describe('buildRunnerCommand', () => {
  it('builds a pnpm runner invocation with bounded crawl options', () => {
    const cmd = buildRunnerCommand({
      startUrl: 'https://example.com',
      appName: 'Example App',
      maxDepth: 2,
      maxPages: 10,
      originSpec: {
        scheme: 'any',
        host: { mode: 'exact', value: 'example.com' },
        port: 'same',
        allowList: [],
        blockList: [],
      },
      sameOriginOnly: true,
      respectRobots: true,
      navTimeoutMs: 20_000,
      waitAfterNavMs: 250,
      viewport: { width: 1440, height: 900 },
      includeUrlPatterns: ['/docs'],
      excludeUrlPatterns: ['/admin'],
      userAgent: 'testworker-smoke',
      captureWebVitals: true,
      collectStorage: true,
    });

    expect(cmd.command).toBe('pnpm');
    expect(cmd.args).toEqual([
      '--filter',
      '@testworker/runner',
      'run',
      'crawl',
      '--url',
      'https://example.com',
      '--app-name',
      'Example App',
      '--max-depth',
      '2',
      '--max-pages',
      '10',
      '--origin-spec',
      '{"scheme":"any","host":{"mode":"exact","value":"example.com"},"port":"same","allowList":[],"blockList":[]}',
      '--nav-timeout-ms',
      '20000',
      '--wait-after-nav-ms',
      '250',
      '--viewport',
      '1440x900',
      '--include-pattern',
      '/docs',
      '--exclude-pattern',
      '/admin',
      '--user-agent',
      'testworker-smoke',
      '--collect-storage',
    ]);
    expect(cmd.env.START_URL).toBe('https://example.com');
    expect(cmd.env.APP_NAME).toBe('Example App');
    expect(cmd.env.ORIGIN_SPEC_JSON).toBe(
      '{"scheme":"any","host":{"mode":"exact","value":"example.com"},"port":"same","allowList":[],"blockList":[]}',
    );
    expect(cmd.env.SAME_ORIGIN_ONLY).toBe('true');
    expect(cmd.env.VIEWPORT_WIDTH).toBe('1440');
    expect(cmd.env.INCLUDE_URL_PATTERNS).toBe('/docs');
    expect(cmd.env.COLLECT_STORAGE).toBe('true');
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
      viewport: { width: 1280, height: 800 },
      includeUrlPatterns: [],
      excludeUrlPatterns: [],
      captureWebVitals: false,
      collectStorage: false,
    });

    expect(cmd.args).toContain('--no-same-origin');
    expect(cmd.args).toContain('--no-respect-robots');
    expect(cmd.args).toContain('--no-web-vitals');
    expect(cmd.env.RESPECT_ROBOTS).toBe('false');
  });
});
