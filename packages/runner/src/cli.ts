#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { CrawlOptions, log, NetworkThrottlePreset, WaitStrategy } from '@testworker/shared';
import { openDb } from './db/client.js';
import { migrate } from './db/migrate.js';
import { loadRunnerEnv, optionsFromEnv } from './config.js';
import { runCrawl } from './crawl/crawler.js';
import { BLOCK_PRESETS, expandBlockPresets } from './crawl/resource-block.js';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      url: { type: 'string' },
      'max-depth': { type: 'string' },
      'max-pages': { type: 'string' },
      'nav-timeout-ms': { type: 'string' },
      'wait-after-nav-ms': { type: 'string' },
      'wait-strategy': { type: 'string' },
      viewport: { type: 'string' },
      'include-pattern': { type: 'string', multiple: true },
      'exclude-pattern': { type: 'string', multiple: true },
      'user-agent': { type: 'string' },
      'cache-mode': { type: 'string' },
      'storage-state': { type: 'string' },
      'login-script': { type: 'string' },
      'inject-script': { type: 'string' },
      'no-same-origin': { type: 'boolean', default: false },
      'no-respect-robots': { type: 'boolean', default: false },
      'no-web-vitals': { type: 'boolean', default: false },
      'auto-scroll': { type: 'boolean', default: false },
      'auto-scroll-max-steps': { type: 'string' },
      'auto-scroll-delay-ms': { type: 'string' },
      block: { type: 'string', multiple: true },
      'network-throttle': { type: 'string' },
      'cpu-throttle': { type: 'string' },
    },
    allowPositionals: true,
  });

  const startUrl = values.url ?? positionals[0] ?? process.env.START_URL;
  if (!startUrl) {
    log.error('usage: testworker-runner <url> [--max-depth N] [--max-pages N] ...');
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
    ...(values['nav-timeout-ms'] ? { navTimeoutMs: Number(values['nav-timeout-ms']) } : {}),
    ...(values['wait-after-nav-ms'] ? { waitAfterNavMs: Number(values['wait-after-nav-ms']) } : {}),
    ...(values['wait-strategy']
      ? { waitStrategy: WaitStrategy.parse(values['wait-strategy']) }
      : {}),
    ...(values.viewport ? { viewport: parseViewport(values.viewport) } : {}),
    ...(values['include-pattern']
      ? { includeUrlPatterns: toStringArray(values['include-pattern']) }
      : {}),
    ...(values['exclude-pattern']
      ? { excludeUrlPatterns: toStringArray(values['exclude-pattern']) }
      : {}),
    ...(values['user-agent'] ? { userAgent: values['user-agent'] } : {}),
    ...(values['cache-mode'] ? { cacheMode: parseCacheMode(values['cache-mode']) } : {}),
    ...(values['storage-state'] ? { storageStatePath: values['storage-state'] } : {}),
    ...(values['login-script'] ? { loginScriptPath: values['login-script'] } : {}),
    ...(values['inject-script'] ? { injectScriptPath: values['inject-script'] } : {}),
    ...(values['no-same-origin'] ? { sameOriginOnly: false } : {}),
    ...(values['no-respect-robots'] ? { respectRobots: false } : {}),
    ...(values['no-web-vitals'] ? { captureWebVitals: false } : {}),
    ...(values['auto-scroll'] ? { autoScroll: true } : {}),
    ...(values['auto-scroll-max-steps']
      ? { autoScrollMaxSteps: Number(values['auto-scroll-max-steps']) }
      : {}),
    ...(values['auto-scroll-delay-ms']
      ? { autoScrollDelayMs: Number(values['auto-scroll-delay-ms']) }
      : {}),
    ...blockOverrides(values.block),
    ...(values['network-throttle']
      ? { networkThrottle: parseNetworkThrottle(values['network-throttle']) }
      : {}),
    ...(values['cpu-throttle'] ? { cpuThrottle: Number(values['cpu-throttle']) } : {}),
  };

  const db = openDb(env.dbPath);
  try {
    log.info(
      { startUrl, maxDepth: overrides.maxDepth, maxPages: overrides.maxPages },
      'crawl start',
    );
    const report = await runCrawl(db, env.dataDir, overrides);
    log.info({ runId: report.run.id, pages: report.pages, edges: report.edges }, 'crawl done');
  } finally {
    db.close();
  }
}

main().catch((err) => {
  // human-readable error message + 「次のアクション」提案 (Issue #128 / Bolt)。
  // 既知の失敗パターンを正規表現で識別し、 troubleshooting.md の該当節へ誘導。
  // 一致しない場合は raw stack を出す (devloop を妨げない)。
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;
  type Hint = { pattern: RegExp; explain: string; nextAction: string; section: string };
  const HINTS: Hint[] = [
    {
      pattern: /ERR_CERT_AUTHORITY_INVALID|self-signed certificate|UNABLE_TO_VERIFY/i,
      explain: '自己署名 / 検証できない TLS 証明書のサイトに当たりました。',
      nextAction:
        'localhost / staging なら https → http で start URL を渡し直してください。 自己署名を許容する場合は mkcert で開発用 CA を OS に登録します。',
      section: '5. certificate',
    },
    {
      pattern: /Timeout \d+ms exceeded/i,
      explain: 'page.goto がデフォルトのタイムアウト (15s) で打ち切られました。',
      nextAction:
        'NAV_TIMEOUT_MS=60000 (CLI env) を渡すと 60 秒に延長できます (上限 120 秒)。 重いページや回線細い環境では先に延ばしてみてください。',
      section: '3. nav failed: timeout',
    },
    {
      pattern: /loginScriptPath|loadLoginScript|login script must default-export/i,
      explain: 'login script の読み込みに失敗しました。',
      nextAction:
        'docs/troubleshooting.md「login fail」節に記載した default-export 形式 (page, context) を確認してください。 LOGIN_EMAIL / LOGIN_PASSWORD などの env を環境に export 済みか再確認も推奨。',
      section: '2. login fail',
    },
    {
      pattern: /SQLITE_CANTOPEN|database is locked|no such table/i,
      explain: 'SQLite DB の open / migration に失敗しました。',
      nextAction:
        '`make migrate` (または `pnpm --filter @testworker/runner run db:migrate`) を先に走らせて DB を初期化してください。 DATA_DIR / DB_PATH の env が正しい絶対パスを指しているかも確認。',
      section: '(migration)',
    },
    {
      pattern: /Cannot find module|Module not found/i,
      explain: '依存モジュールが見つかりません。',
      nextAction:
        'リポジトリ root で `pnpm install --frozen-lockfile` を実行してください。 docker で動かしているなら `make up --build` で image rebuild。',
      section: '(env setup)',
    },
  ];

  log.error({ message }, 'crawl FAILED');
  for (const h of HINTS) {
    if (h.pattern.test(message)) {
      log.error(
        { explain: h.explain, nextAction: h.nextAction, section: h.section },
        'troubleshooting hint',
      );
      process.exit(1);
    }
  }
  // 一致しなかった場合は raw stack を出して devloop を阻害しない
  if (stack) log.error({ stack }, 'raw stack trace');
  log.error(
    '既知の失敗パターンに該当しません。 docs/troubleshooting.md を参照するか、 上記 stack を Issue に貼って報告してください。',
  );
  process.exit(1);
});

function parseNetworkThrottle(raw: string): NetworkThrottlePreset {
  const parsed = NetworkThrottlePreset.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid network-throttle: ${raw} (expected none|offline|slow-3g|fast-3g)`);
  }
  return parsed.data;
}

function parseViewport(raw: string): { width: number; height: number } {
  const match = raw.match(/^(\d+)x(\d+)$/);
  if (!match) throw new Error(`invalid viewport: ${raw} (expected WIDTHxHEIGHT)`);
  return { width: Number(match[1]), height: Number(match[2]) };
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

// `--block analytics|ads|fonts` (repeatable) を CrawlOptions の 2 配列に展開する。
// 未知のプリセットは早期に弾いて usage を出す (誤入力の sink を作らない)。
function blockOverrides(
  raw: string | string[] | undefined,
): { blockResourceTypes: string[]; blockUrlPatterns: string[] } | object {
  const presets = toStringArray(raw);
  if (presets.length === 0) return {};
  const allowed: readonly string[] = BLOCK_PRESETS;
  const unknown = presets.filter((p) => !allowed.includes(p));
  if (unknown.length > 0) {
    log.error(`unknown --block preset: ${unknown.join(', ')} (allowed: ${allowed.join(', ')})`);
    process.exit(1);
  }
  return expandBlockPresets(presets);
}

function parseCacheMode(raw: string): CrawlOptions['cacheMode'] {
  const parsed = CrawlOptions.shape.cacheMode.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`invalid --cache-mode: ${raw} (expected cold|warm|disabled)`);
  }
  return parsed.data;
}
