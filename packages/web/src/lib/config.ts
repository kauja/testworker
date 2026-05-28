/**
 * web のサーバ側コンフィグ (Intent #127 / Bolt: read-only モード)。
 *
 * 環境変数で testworker UI の振る舞いを切り替える。 現状は read-only モードのみ。
 * Server Component / Server Action / API ハンドラから直接呼ぶ。
 *
 * Browser から見えるべきフラグは next.config.* で `NEXT_PUBLIC_*` を export 経由で
 * Client に渡すが、 testworker は server-side rendering で完結するので
 * 現在は public 化しない (将来 client-side edit UI を足すときに `NEXT_PUBLIC_TESTWORKER_READ_ONLY`
 * を別途追加する)。
 */

export interface WebConfig {
  /**
   * UI を閲覧専用にする。 true なら edit 系 UI を hide / disable し、 banner を表示。
   * Default は false (= 通常モード)。
   * env: `TESTWORKER_READ_ONLY=1` / `true` / `yes` で有効化。
   */
  readOnly: boolean;
}

function truthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function getWebConfig(): WebConfig {
  return {
    readOnly: truthy(process.env.TESTWORKER_READ_ONLY),
  };
}
