import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { log } from '@testworker/shared';
import type { RunLaunchInput } from '@testworker/shared';

export interface RunnerCommand {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export function buildRunnerCommand(options: RunLaunchInput): RunnerCommand {
  const command = process.env.TESTWORKER_RUNNER_COMMAND ?? 'pnpm';
  const cwd = process.env.TESTWORKER_RUNNER_CWD ?? process.cwd();
  const args =
    command === 'pnpm'
      ? ['--filter', '@testworker/runner', 'run', 'crawl']
      : splitArgs(process.env.TESTWORKER_RUNNER_ARGS ?? '');

  args.push('--url', options.startUrl);
  args.push('--max-depth', String(options.maxDepth));
  args.push('--max-pages', String(options.maxPages));
  args.push('--nav-timeout-ms', String(options.navTimeoutMs));
  args.push('--wait-after-nav-ms', String(options.waitAfterNavMs));
  args.push('--viewport', `${options.viewport.width}x${options.viewport.height}`);
  for (const pattern of options.includeUrlPatterns) args.push('--include-pattern', pattern);
  for (const pattern of options.excludeUrlPatterns) args.push('--exclude-pattern', pattern);
  if (options.userAgent) args.push('--user-agent', options.userAgent);
  if (!options.sameOriginOnly) args.push('--no-same-origin');
  if (!options.respectRobots) args.push('--no-respect-robots');
  if (!options.captureWebVitals) args.push('--no-web-vitals');

  return {
    command,
    args,
    cwd,
    env: {
      ...process.env,
      START_URL: options.startUrl,
      MAX_DEPTH: String(options.maxDepth),
      MAX_PAGES: String(options.maxPages),
      NAV_TIMEOUT_MS: String(options.navTimeoutMs),
      WAIT_AFTER_NAV_MS: String(options.waitAfterNavMs),
      VIEWPORT_WIDTH: String(options.viewport.width),
      VIEWPORT_HEIGHT: String(options.viewport.height),
      INCLUDE_URL_PATTERNS: options.includeUrlPatterns.join('\n'),
      EXCLUDE_URL_PATTERNS: options.excludeUrlPatterns.join('\n'),
      USER_AGENT: options.userAgent ?? '',
      SAME_ORIGIN_ONLY: options.sameOriginOnly ? 'true' : 'false',
      RESPECT_ROBOTS: options.respectRobots ? 'true' : 'false',
      CAPTURE_WEB_VITALS: options.captureWebVitals ? 'true' : 'false',
    },
  };
}

export function launchCrawl(options: RunLaunchInput): ChildProcess {
  const cmd = buildRunnerCommand(options);
  const child = spawn(cmd.command, cmd.args, {
    cwd: cmd.cwd,
    env: cmd.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout?.on('data', (chunk) => process.stdout.write(prefixLines('runner', chunk)));
  child.stderr?.on('data', (chunk) => process.stderr.write(prefixLines('runner', chunk)));
  child.on('error', (err) => {
    log.error({ err: err.message }, 'runner spawn failed');
  });
  child.on('exit', (code, signal) => {
    if (code === 0) {
      log.info('runner completed');
      return;
    }
    log.warn(
      { signal, code },
      `runner exited with ${signal ? `signal ${signal}` : `code ${code}`}`,
    );
  });

  return child;
}

function prefixLines(label: string, chunk: Buffer): string {
  return chunk
    .toString('utf8')
    .split(/\n/)
    .map((line, idx, lines) => {
      if (idx === lines.length - 1 && line === '') return '';
      return `[testworker-api:${label}] ${line}\n`;
    })
    .join('');
}

function splitArgs(raw: string): string[] {
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
