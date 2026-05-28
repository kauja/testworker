import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrawlOptions } from '@testworker/shared';
import { loadInjectScript } from './inject.js';

describe('loadInjectScript', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'tw-inject-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('reads the file content verbatim as a string', async () => {
    const file = join(dir, 'inject.js');
    const source = "window.__tw = true;\nconsole.log('injected');\n";
    await writeFile(file, source, 'utf-8');
    await expect(loadInjectScript(file)).resolves.toBe(source);
  });

  it('throws when the file does not exist', async () => {
    await expect(loadInjectScript(join(dir, 'nope.js'))).rejects.toThrow(/not found/);
  });

  it('rejects disallowed extensions', async () => {
    const file = join(dir, 'inject.json');
    await writeFile(file, '{}', 'utf-8');
    await expect(loadInjectScript(file)).rejects.toThrow(/extension/);
  });

  it('rejects an empty script', async () => {
    const file = join(dir, 'empty.js');
    await writeFile(file, '   \n', 'utf-8');
    await expect(loadInjectScript(file)).rejects.toThrow(/empty/);
  });
});

describe('CrawlOptions.injectScriptPath', () => {
  it('is optional and absent by default (backward compatible)', () => {
    const opts = CrawlOptions.parse({ startUrl: 'https://example.com' });
    expect(opts.injectScriptPath).toBeUndefined();
  });

  it('passes through when provided (mirrors CLI --inject-script mapping)', () => {
    const opts = CrawlOptions.parse({
      startUrl: 'https://example.com',
      injectScriptPath: '/abs/path/inject.js',
    });
    expect(opts.injectScriptPath).toBe('/abs/path/inject.js');
  });
});
