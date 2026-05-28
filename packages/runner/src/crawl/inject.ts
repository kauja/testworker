import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';

/**
 * カスタム JS 注入フック (Issue #203)。
 *
 * loginScript と違い動的 import (= Node ホスト上で実行) しない。 指定ファイルの内容を
 * 文字列として読み、 `context.addInitScript(content)` でブラウザのページコンテキストに
 * 注入する。 つまり実行されるのは「巡回対象ページの中」であって、 runner プロセスでは
 * ない。 各ページの全 script より前 (= 評価前) に毎回走る。
 *
 * 用途例: feature flag の上書き、 アニメ無効化、 analytics の stub、 console.log の付与など。
 *
 * セキュリティ: 注入された文字列はそのままページ DOM 上で実行され、 ネットワーク経由で
 * 外部に観測されうる。 トークン / パスワード / API キー等の秘密値はここに入れないこと
 * (秘密が必要な認証は loginScript + 環境変数を使う)。 import を行わずファイル内容を
 * そのまま渡すため、 Node ホスト側での任意コード実行 (Issue #58 の脅威) は成立しない。
 */
const ALLOWED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.ts']);

export async function loadInjectScript(path: string): Promise<string> {
  if (!existsSync(path)) {
    throw new Error(`inject script not found: ${path}`);
  }
  const ext = extname(path).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error(
      `inject script must have one of [${[...ALLOWED_EXTENSIONS].join(', ')}] extension: ${path}`,
    );
  }
  const content = await readFile(path, 'utf-8');
  if (content.trim().length === 0) {
    throw new Error(`inject script is empty: ${path}`);
  }
  return content;
}
