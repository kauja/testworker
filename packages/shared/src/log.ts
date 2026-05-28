import { pino, type Logger } from 'pino';

/**
 * testworker 共通の構造化 logger (Issue #92)。
 *
 * 各 service (runner / api) は import 時に SERVICE 環境変数 (デフォルト
 * 'testworker') を `base.service` として log line に含める。 並列 worker
 * 観測時に grep '\"service\":\"runner\"' 等で絞れるようにするため。
 *
 * level / format は環境変数:
 *   - LOG_LEVEL: pino の level (trace / debug / info / warn / error / fatal)。
 *                未指定は 'info'。
 *   - LOG_FORMAT: 'pretty' を指定すると pino-pretty 経由で人間可読出力に。
 *                 dev / make crawl などで読みやすくするための opt-in。
 *
 * child logger は `childLog({ runId })` で context を引き継ぐ。 各 log 行に
 * runId / pageId などの field が自動付与される。
 */
/**
 * LOG_FORMAT 未指定時は stdout が TTY なら 'pretty' に倒す (dev UX)。
 * CI / docker / pipe にリダイレクトされた場合は JSON のまま (集約基盤対応)。
 */
const wantPretty =
  process.env.LOG_FORMAT === 'pretty' ||
  (process.env.LOG_FORMAT !== 'json' && process.stdout.isTTY);

export const log: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { service: process.env.SERVICE ?? 'testworker' },
  ...(wantPretty
    ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: true } } }
    : {}),
});

export const childLog = (ctx: Record<string, unknown>): Logger => log.child(ctx);
