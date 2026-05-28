import type { Metadata } from 'next';
import Link from 'next/link';
import { getWebConfig } from '@/lib/config';
import './globals.css';

export const metadata: Metadata = {
  title: 'testworker',
  description: 'Crawl, observe, visualize.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const config = getWebConfig();
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-bg text-ink">
        {config.readOnly && (
          <div
            role="status"
            className="border-b border-accent/40 bg-accent/10 px-6 py-1.5 text-center text-[11px] text-accent"
          >
            閲覧専用モード (TESTWORKER_READ_ONLY) — 将来追加される編集系 UI (コメント / 削除 /
            再クロール etc.) は無効化されます。
          </div>
        )}
        <header className="border-b border-line/80">
          <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-6 px-6">
            <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
              <span className="inline-block size-2 rounded-full bg-accent" />
              testworker
              {config.readOnly && (
                <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-accent">
                  read-only
                </span>
              )}
            </Link>
            <nav className="flex items-center gap-4 text-xs text-ink-muted">
              <Link href="/" className="hover:text-ink">
                Runs
              </Link>
              <a href={config.repoUrl} target="_blank" rel="noreferrer" className="hover:text-ink">
                GitHub
              </a>
            </nav>
          </div>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
