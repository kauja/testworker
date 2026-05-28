'use client';

/**
 * Client component for the report page (Intent #127 / Bolt: 静的レポート HTML エクスポート)。
 *
 * window.print() を呼ぶ単純ボタン。 OS / ブラウザの「PDF として保存」ダイアログ経由で
 * 1 ファイル PDF を生成できる。 メール / Slack 添付の portable artifact として共有可能。
 */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border border-accent bg-accent/10 px-3 py-1.5 text-accent hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      印刷 / PDF 保存
    </button>
  );
}
