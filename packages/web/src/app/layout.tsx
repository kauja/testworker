import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'testworker',
  description: 'Crawl, observe, visualize.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh bg-bg text-ink">
        <header className="border-b border-line/80">
          <div className="mx-auto flex h-12 max-w-screen-2xl items-center gap-6 px-6">
            <Link href="/" className="flex items-center gap-2 text-sm font-medium tracking-tight">
              <span className="inline-block size-2 rounded-full bg-accent" />
              testworker
            </Link>
            <nav className="flex items-center gap-4 text-xs text-ink-muted">
              <Link href="/" className="hover:text-ink">
                Runs
              </Link>
              <a
                href="https://github.com/"
                target="_blank"
                rel="noreferrer"
                className="hover:text-ink"
              >
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
