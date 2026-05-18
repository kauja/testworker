import { CrawlOptions } from '@testworker/shared';

export interface RunnerEnv {
  dataDir: string;
  dbPath: string;
}

export function loadRunnerEnv(): RunnerEnv {
  const dataDir = process.env.DATA_DIR ?? './data';
  const dbPath = process.env.DB_PATH ?? `${dataDir}/db/testworker.sqlite`;
  return { dataDir, dbPath };
}

export function optionsFromEnv(startUrl: string): CrawlOptions {
  return CrawlOptions.parse({
    startUrl,
    maxDepth: numberFromEnv('MAX_DEPTH'),
    maxPages: numberFromEnv('MAX_PAGES'),
    sameOriginOnly: boolFromEnv('SAME_ORIGIN_ONLY'),
    navTimeoutMs: numberFromEnv('NAV_TIMEOUT_MS'),
    waitAfterNavMs: numberFromEnv('WAIT_AFTER_NAV_MS'),
    storageStatePath: process.env.STORAGE_STATE_PATH || undefined,
    loginScriptPath: process.env.LOGIN_SCRIPT_PATH || undefined,
    userAgent: process.env.USER_AGENT || undefined,
  });
}

function numberFromEnv(key: string): number | undefined {
  const raw = process.env[key];
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function boolFromEnv(key: string): boolean | undefined {
  const raw = process.env[key];
  if (raw == null) return undefined;
  return raw === '1' || raw.toLowerCase() === 'true';
}
