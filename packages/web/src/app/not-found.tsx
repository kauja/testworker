import Link from 'next/link';

/**
 * Global 404 ページ (#186)。
 *
 * Next.js デフォルトの「This page could not be found.」 (英語固定) を上書きする。
 * 不正な URL / typo / purge (#133) 後の dead link で着地したユーザに、
 *  「該当 run が無い」 「Runs 一覧に戻れる」 ことを JA で明示する。
 *
 * dynamic routes (`/runs/[id]/...` 等) で `notFound()` が呼ばれた場合も、
 * route directory に not-found.tsx が無ければ root の本ファイルが描画される。
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-3rem)] max-w-screen-md flex-col items-center justify-center px-6 py-10 text-center">
      <div className="mb-3 text-[11px] uppercase tracking-[0.2em] text-ink-faint">404</div>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        該当する run が見つかりません
      </h1>
      <p className="mt-3 max-w-prose text-sm text-ink-muted">
        URL を typo した、 共有された link が古い、 または{' '}
        <code className="rounded bg-bg-panel px-1.5 py-0.5 font-mono text-[12px] text-ink">
          run purge
        </code>{' '}
        (Issue #133) で消えた可能性があります。 Runs 一覧から最新の run を選び直してください。
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/"
          className="rounded-md border border-accent bg-accent/10 px-4 py-2 text-sm text-accent hover:bg-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          ← Runs 一覧に戻る
        </Link>
        <a
          href="https://github.com/kauja/testworker/blob/main/docs/troubleshooting.md"
          target="_blank"
          rel="noreferrer"
          className="text-xs text-ink-muted hover:text-ink underline-offset-2 hover:underline"
        >
          docs/troubleshooting.md
        </a>
      </div>
    </div>
  );
}
