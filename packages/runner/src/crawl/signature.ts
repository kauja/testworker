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

export const STRUCTURE_SCRIPT = `() => {
  // id は SPA で動的に発番されることが多い（user-1234, render-uuid 等）。
  // 完全に外すと情報量が落ちるので、長い数字列・hex 列を含む id は弾く。
  const STABLE_ATTRS = ['role', 'data-testid', 'data-test', 'aria-label', 'name'];
  const STABLE_ID_SHAPE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
  const UNSTABLE_ID_HINT = /\\d{4,}|[a-fA-F0-9]{8,}/;
  // depth=6, children=24 だけだと幅広い landmark で tokens 文字列が MB 級に
  // 達することがあり、 sha1 計算 + Playwright bridge serialization で 1 ページ
  // 数百ms〜数秒の負荷になる (Issue #99)。 累積 length が threshold を超えたら
  // 以降は sentinel を返して短絡し、 hash 入力サイズを bound する。
  const MAX_TOKENS_LENGTH = 65536;
  let totalLength = 0;

  function tokenize(el, depth) {
    if (totalLength > MAX_TOKENS_LENGTH) return '#OVERFLOW';
    if (depth > 6) return '';
    const tag = el.tagName.toLowerCase();
    const attrs = [];
    const id = el.getAttribute('id');
    if (id && STABLE_ID_SHAPE.test(id) && !UNSTABLE_ID_HINT.test(id)) {
      attrs.push('id=' + id);
    }
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute(a);
      if (v) attrs.push(a + '=' + v.slice(0, 32));
    }
    const head = attrs.length ? tag + '[' + attrs.join(',') + ']' : tag;
    const kids = Array.from(el.children).slice(0, 24).map((c) => tokenize(c, depth + 1)).join(',');
    const result = kids ? head + '{' + kids + '}' : head;
    totalLength += result.length;
    return result;
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
