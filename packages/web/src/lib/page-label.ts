/**
 * Page node / table 行の見出しを決める fallback 戦略 (#174)。
 *
 * 多くの SPA (Next.js + 共通 layout / React Router) は全 route で同じ `<title>` を
 * 持つため、 そのまま表示するとノードが全部 "testworker" のように区別不能になる。
 * 以下の decision tree で「最も識別性が高い short label」 を返す:
 *
 *   1. title が unique かつ非空 → title
 *   2. duplicate / 空 / untitled → URL の path 部分 (root は "/")
 *   3. それでも区別できない場合は呼び出し側で id 末尾を足してもらう
 *
 * Product Principles: 決定論的 (`if` チェーン), AI / 外部 SaaS 非依存。
 *
 * 使い方:
 *
 *   const labels = computePageLabels(pages);
 *   labels.get(page.id) ?? '(untitled)'
 */

export interface PageLikeForLabel {
  id: string;
  url: string;
  title: string;
}

const EMPTY_TITLES = new Set(['', '(untitled)', 'untitled']);

/**
 * URL から「path の最終 segment + query 短縮」 のような短い label を作る。
 * 例:
 *   `http://web:3000/runs/run_jps23/diff` → `runs/run_jps23/diff`
 *   `https://example.com/` → `/`
 *   `https://example.com/foo/bar?x=1` → `/foo/bar?x=…`
 */
export function urlToPathLabel(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    let p = u.pathname;
    if (!p || p === '/') p = '/';
    // 末尾 / は読みづらいので落とす (root '/' は維持)。
    if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
    // query は最初の 1 つだけ短縮表示 (key=… ... に縮める)。
    let q = '';
    if (u.search) {
      const params = [...u.searchParams.keys()];
      if (params.length > 0) {
        q = `?${params[0]}=…${params.length > 1 ? `+${params.length - 1}` : ''}`;
      }
    }
    return `${p}${q}`;
  } catch {
    // 不正な URL (ありえないが念のため) はそのまま
    return rawUrl;
  }
}

/**
 * 与えられた pages について、 「unique かつ非空の title なら title、 さもなくば
 * URL path」 という戦略で各 page の表示 label を計算して `Map<id, label>` を返す。
 */
export function computePageLabels<T extends PageLikeForLabel>(
  pages: readonly T[],
): Map<string, string> {
  const titleCounts = new Map<string, number>();
  for (const p of pages) {
    const t = (p.title ?? '').trim();
    if (!t || EMPTY_TITLES.has(t.toLowerCase())) continue;
    titleCounts.set(t, (titleCounts.get(t) ?? 0) + 1);
  }

  const result = new Map<string, string>();
  for (const p of pages) {
    const t = (p.title ?? '').trim();
    const isEmpty = !t || EMPTY_TITLES.has(t.toLowerCase());
    const isUnique = !isEmpty && (titleCounts.get(t) ?? 0) === 1;
    if (isUnique) {
      result.set(p.id, t);
    } else {
      result.set(p.id, urlToPathLabel(p.url));
    }
  }
  return result;
}
