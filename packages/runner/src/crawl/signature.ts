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
  navHash: string;
  structureHash: string;
}

export const NAV_SCRIPT = `() => {
  const STABLE_ATTRS = ['role', 'data-testid', 'data-test', 'aria-label', 'name'];
  const STABLE_ID_SHAPE = /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/;
  const UNSTABLE_ID_HINT = /\\d{4,}|[a-fA-F0-9]{8,}/;

  function attrsOf(el) {
    const attrs = [];
    const id = el.getAttribute('id');
    if (id && STABLE_ID_SHAPE.test(id) && !UNSTABLE_ID_HINT.test(id)) {
      attrs.push('id=' + id);
    }
    for (const a of STABLE_ATTRS) {
      const v = el.getAttribute(a);
      if (v) attrs.push(a + '=' + v.slice(0, 32));
    }
    return attrs;
  }

  function tokenize(el, depth) {
    if (depth > 4) return '';
    const tag = el.tagName.toLowerCase();
    const attrs = attrsOf(el);
    const own = attrs.length ? tag + '[' + attrs.join(',') + ']' : tag;
    const linkish = Array.from(el.querySelectorAll ? el.querySelectorAll('a,button,[role=button],[role=link]') : [])
      .slice(0, 32)
      .map((child) => {
        const childTag = child.tagName.toLowerCase();
        const childAttrs = attrsOf(child);
        return childAttrs.length ? childTag + '[' + childAttrs.join(',') + ']' : childTag;
      })
      .join(',');
    const kids = Array.from(el.children).slice(0, 12).map((c) => tokenize(c, depth + 1)).join(',');
    return own + '{' + [linkish, kids].filter(Boolean).join('|') + '}';
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function overlayKind(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if ((tag === 'dialog' && el.hasAttribute('open')) || role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true') {
      return 'dialog';
    }
    if (role === 'alert' || role === 'status') return 'alert';
    if (el.getAttribute('aria-expanded') === 'true') return 'disclosure';
    const style = getComputedStyle(el);
    const z = Number.parseInt(style.zIndex || '0', 10);
    if (style.position === 'fixed' && Number.isFinite(z) && z >= 1000) {
      const r = el.getBoundingClientRect();
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      if ((r.width * r.height) / viewportArea >= 0.3) return 'drawer';
      return 'popover';
    }
    return null;
  }

  function overlayTokens() {
    const selectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      'dialog[open]',
      '[role="alert"]',
      '[role="status"]',
      '[aria-modal="true"]',
      '[aria-expanded="true"]',
    ];
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    document.querySelectorAll('body *').forEach((el) => {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed') return;
      const z = Number.parseInt(style.zIndex || '0', 10);
      if (Number.isFinite(z) && z >= 1000) candidates.push(el);
    });
    const seen = new Set();
    return candidates
      .filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        return visible(el) && overlayKind(el);
      })
      .slice(0, 16)
      .map((el) => overlayKind(el) + ':' + tokenize(el, 0))
      .join('|');
  }

  const landmarks = ['header', 'nav', 'aside', '[role=navigation]'];
  const seen = new Set();
  const parts = [];
  for (const sel of landmarks) {
    document.querySelectorAll(sel).forEach((el) => {
      if (seen.has(el)) return;
      seen.add(el);
      parts.push(tokenize(el, 0));
    });
  }
  return { tokens: parts.join('|'), pathname: location.pathname, search: location.search };
}`;

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

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  function overlayKind(el) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role');
    if ((tag === 'dialog' && el.hasAttribute('open')) || role === 'dialog' || role === 'alertdialog' || el.getAttribute('aria-modal') === 'true') {
      return 'dialog';
    }
    if (role === 'alert' || role === 'status') return 'alert';
    if (el.getAttribute('aria-expanded') === 'true') return 'disclosure';
    const style = getComputedStyle(el);
    const z = Number.parseInt(style.zIndex || '0', 10);
    if (style.position === 'fixed' && Number.isFinite(z) && z >= 1000) {
      const r = el.getBoundingClientRect();
      const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);
      if ((r.width * r.height) / viewportArea >= 0.3) return 'drawer';
      return 'popover';
    }
    return null;
  }

  function overlayTokens() {
    const selectors = [
      '[role="dialog"]',
      '[role="alertdialog"]',
      'dialog[open]',
      '[role="alert"]',
      '[role="status"]',
      '[aria-modal="true"]',
      '[aria-expanded="true"]',
    ];
    const candidates = Array.from(document.querySelectorAll(selectors.join(',')));
    document.querySelectorAll('body *').forEach((el) => {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed') return;
      const z = Number.parseInt(style.zIndex || '0', 10);
      if (Number.isFinite(z) && z >= 1000) candidates.push(el);
    });
    const seen = new Set();
    return candidates
      .filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        return visible(el) && overlayKind(el);
      })
      .slice(0, 16)
      .map((el) => overlayKind(el) + ':' + tokenize(el, 0))
      .join('|');
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
  const overlays = overlayTokens();
  if (overlays) parts.push('overlays{' + overlays + '}');
  const visibleH = Math.max(
    document.documentElement.scrollHeight,
    document.body ? document.body.scrollHeight : 0,
  );
  return { tokens: parts.join('|'), pathname: location.pathname, search: location.search, hash: location.hash, scrollH: visibleH };
}`;

export async function computeNavHash(page: Page): Promise<string> {
  const dom = (await page.evaluate(`(${NAV_SCRIPT})()`)) as {
    tokens: string;
    pathname: string;
    search: string;
  };
  return createHash('sha1')
    .update(`${dom.pathname}${dom.search}|${dom.tokens}`)
    .digest('hex')
    .slice(0, 16);
}

export async function computeStructureHash(page: Page): Promise<{
  hash: string;
  pathname: string;
  search: string;
  hashFragment: string;
}> {
  const dom = (await page.evaluate(`(${STRUCTURE_SCRIPT})()`)) as {
    tokens: string;
    pathname: string;
    search: string;
    hash: string;
    scrollH: number;
  };
  return {
    hash: createHash('sha1').update(dom.tokens).digest('hex').slice(0, 16),
    pathname: dom.pathname,
    search: dom.search,
    hashFragment: dom.hash,
  };
}

export async function computeSignature(page: Page): Promise<PageSignature> {
  const url = page.url();
  const title = await page.title().catch(() => '');
  // STRUCTURE_SCRIPT は `() => { ...; return { tokens, ... } }` のアロー関数リテラル文字列。
  // page.evaluate(string) は文字列を expression として評価するため、 そのままだと結果は
  // 「関数オブジェクト」になり呼び出されない (= dom.tokens が undefined になり crash)。
  // IIFE 形にラップして「定義した関数を即実行した戻り値」を得る (Issue #135)。
  const [navHash, structure] = await Promise.all([
    computeNavHash(page),
    computeStructureHash(page),
  ]);
  // path + search + hash + structure を組み合わせる。
  // 同一 URL でも DOM が違えば別ノード、同一 DOM でも URL が違えば別ノードになる。
  const signature = `${structure.pathname}${structure.search}${structure.hashFragment}#${structure.hash}`;
  return {
    signature,
    url,
    pathname: structure.pathname,
    title,
    navHash,
    structureHash: structure.hash,
  };
}
