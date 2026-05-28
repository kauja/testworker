import { describe, expect, it, vi } from 'vitest';
import { pickValidOptionFields, rowToRun } from './queries.js';

const baseRow = (options: unknown, overrides: Partial<Parameters<typeof rowToRun>[0]> = {}) => ({
  id: 'run_1',
  start_url: 'https://example.com/start',
  status: 'completed',
  started_at: '2026-01-01T00:00:00.000Z',
  finished_at: null,
  options_json: typeof options === 'string' ? options : JSON.stringify(options),
  error_message: null,
  pages_done: 0,
  queue_size: null,
  current_url: null,
  har_path: null,
  ...overrides,
});

describe('rowToRun', () => {
  it('merges legacy options with row start_url and zod defaults', () => {
    const run = rowToRun(
      baseRow({
        maxDepth: 2,
        maxPages: 12,
        sameOriginOnly: false,
        viewport: { width: 390, height: 844 },
        includeUrlPatterns: ['/docs'],
      }),
    );

    expect(run.options).toMatchObject({
      startUrl: 'https://example.com/start',
      maxDepth: 2,
      maxPages: 12,
      sameOriginOnly: false,
      navTimeoutMs: 15_000,
      viewport: { width: 390, height: 844 },
      includeUrlPatterns: ['/docs'],
    });
  });

  it('falls back to defaults when options_json is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = rowToRun(baseRow('{bad json'));

    expect(run.options).toMatchObject({
      startUrl: 'https://example.com/start',
      maxDepth: 3,
      maxPages: 50,
      sameOriginOnly: true,
    });
    expect(warn).toHaveBeenCalledWith(
      '[testworker-api] run run_1: options_json JSON.parse failed',
      expect.any(String),
    );
    warn.mockRestore();
  });

  it('keeps valid fields when one option field is invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = rowToRun(
      baseRow({
        startUrl: 'https://example.com/from-json',
        maxDepth: 'bad',
        maxPages: 7,
        viewport: { width: 1024, height: 768 },
      }),
    );

    expect(run.options).toMatchObject({
      startUrl: 'https://example.com/from-json',
      maxDepth: 3,
      maxPages: 7,
      viewport: { width: 1024, height: 768 },
    });
    warn.mockRestore();
  });

  it('preserves non-url legacy start_url in the final fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const run = rowToRun(baseRow({ maxPages: 9 }, { start_url: 'localhost:3000' }));

    expect(run.options).toMatchObject({
      startUrl: 'localhost:3000',
      maxDepth: 3,
      maxPages: 9,
      sameOriginOnly: true,
    });
    warn.mockRestore();
  });
});

describe('pickValidOptionFields', () => {
  it('drops invalid fields without discarding valid siblings', () => {
    expect(
      pickValidOptionFields({
        startUrl: 'https://example.com',
        maxDepth: 4,
        maxPages: 0,
        sameOriginOnly: false,
        viewport: { width: -1, height: 800 },
        includeUrlPatterns: ['/ok'],
        unknown: 'ignored',
      }),
    ).toEqual({
      startUrl: 'https://example.com',
      maxDepth: 4,
      sameOriginOnly: false,
      includeUrlPatterns: ['/ok'],
    });
  });
});
