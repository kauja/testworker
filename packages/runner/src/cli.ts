#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { openDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { loadRunnerEnv, optionsFromEnv } from './config.js';
import { runCrawl } from './crawl/crawler.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      url: { type: 'string' },
      'max-depth': { type: 'string' },
      'max-pages': { type: 'string' },
      'storage-state': { type: 'string' },
      'login-script': { type: 'string' },
      'no-same-origin': { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const startUrl = values.url ?? positionals[0] ?? process.env.START_URL;
  if (!startUrl) {
    console.error('usage: testworker-runner <url> [--max-depth N] [--max-pages N] ...');
    process.exit(1);
  }

  const env = loadRunnerEnv();
  migrate(env.dbPath);

  const base = optionsFromEnv(startUrl);
  const overrides = {
    ...base,
    startUrl,
    ...(values['max-depth'] ? { maxDepth: Number(values['max-depth']) } : {}),
    ...(values['max-pages'] ? { maxPages: Number(values['max-pages']) } : {}),
    ...(values['storage-state'] ? { storageStatePath: values['storage-state'] } : {}),
    ...(values['login-script'] ? { loginScriptPath: values['login-script'] } : {}),
    ...(values['no-same-origin'] ? { sameOriginOnly: false } : {}),
  };

  const db = openDb(env.dbPath);
  try {
    console.log(`[testworker] crawl start: ${startUrl}`);
    console.log(`  depth=${overrides.maxDepth} pages=${overrides.maxPages}`);
    const report = await runCrawl(db, env.dataDir, overrides);
    console.log(`[testworker] done: run=${report.run.id} pages=${report.pages} edges=${report.edges}`);
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
