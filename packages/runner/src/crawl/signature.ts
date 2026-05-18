import { createHash } from 'node:crypto';
import type { Page } from 'playwright';

/**
 * 画面状態シグネチャの生成。
 *
 * 同じ URL でも DOM 構造が違えば別の「画面」とみなす（SPA 対応）。
 * 一方で動的テキストや乱数で過剰に分岐しないよう、
 *   - タグ階層
 *   - id / role / data-testid のような安定属性
 *   - 主要ランドマーク（header/nav/main/footer/aside）の outline
 * のみからハッシュを作る。
 */
export interface PageSignature {
  signature: string;
  url: string;
  pathname: string;
  title: string;
  structureHash: string;
}

const STRUCTURE_SCRIPT = `() => {
  const STABLE_ATTRS = ['id', 'role', 'data-testid', 'data-test', 'aria-label', 'name'];

  function tokenize(el, depth) {
    if (depth > 6) return '';
    const tag = el.tagName.toLowerCase();
    const attrs = [];
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute(a);
      if (v) attrs.push(a + '=' + v.slice(0, 32));
    }
    const head = attrs.length ? tag + '[' + attrs.join(',') + ']' : tag;
    const kids = Array.from(el.children).slice(0, 24).map((c) => tokenize(c, depth + 1)).join(',');
    return kids ? head + '{' + kids + '}' : head;
  }

  const landmarks = ['header', 'nav', 'main', 'footer', 'aside', '[role=main]', '[role=navigation]'];
  const seen = new Set();
  const parts = [];
  for (const sel of landmarks) {
    document.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      parts.push(tokenize(el, 0));
    });
  }
  if (parts.length === 0 && document.body) {
    parts.push(tokenize(document.body, 0));
  }
  const visibleH = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
  );
  return { tokens: parts.join('|'), pathname: location.pathname, search: location.search, hash: location.hash, scrollH: visibleH };
}`;

export async function computeSignature(page: Page): Promise<PageSignature> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  const dom = (await page.evaluate(STRUCTURE_SCRIPT)) as {
    tokens: string;
    pathname: string;
    search: string;
    hash: string;
    scrollH: number;
  };

  const structureHash = createHash('sha1').update(dom.tokens).digest('hex').slice(0, 16);
  // path + search + hash + structure を組み合わせる。
  // 同一 URL でも DOM が違えば別ノード、同一 DOM でも URL が違えば別ノードになる。
  const signature = `${dom.pathname}${dom.search}${dom.hash}#${structureHash}`;
  return {
    signature,
    url,
    pathname: dom.pathname,
    title,
    structureHash,
  };
}
