import type { Page } from 'playwright';

export interface Interaction {
  kind: 'link' | 'button' | 'form-submit' | 'spa-route';
  selector: string;
  text: string;
  href: string | null;
}

/**
 * 「クリックして遷移しうる」候補要素を収集する。
 *
 * - 通常のリンク（<a href> / area[href]）
 * - ルーティング属性付きボタン（role=link, data-href, [data-route] 等）
 * - 主要な action ボタン（<button>, [role=button]）
 *
 * MVP では form 送信や任意 input への自動入力までは扱わない。
 */
const COLLECT_SCRIPT = `() => {
  const seen = new Set();
  const out = [];

  function selectorFor(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    const dt = el.getAttribute('data-testid');
    if (dt) return '[data-testid="' + dt.replace(/"/g, '\\\\"') + '"]';
    const parts = [];
    let cur = el;
    while (cur && cur.nodeType === 1 && parts.length < 4) {
      let part = cur.tagName.toLowerCase();
      if (cur.parentElement) {
        const idx = Array.prototype.indexOf.call(cur.parentElement.children, cur) + 1;
        part += ':nth-child(' + idx + ')';
      }
      parts.unshift(part);
      cur = cur.parentElement;
    }
    return parts.join(' > ');
  }

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.pointerEvents !== 'none';
  }

  function pushUnique(record) {
    const key = record.kind + '|' + record.selector + '|' + (record.href || '');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(record);
  }

  document.querySelectorAll('a[href], area[href]').forEach((a) => {
    if (!visible(a)) return;
    const href = a.getAttribute('href');
    if (!href) return;
    if (href.startsWith('javascript:')) return;
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
    pushUnique({
      kind: 'link',
      selector: selectorFor(a),
      text: (a.textContent || '').trim().slice(0, 80),
      href,
    });
  });

  const buttonSel = 'button, [role="button"], [data-href], [data-route]';
  document.querySelectorAll(buttonSel).forEach((b) => {
    if (!visible(b)) return;
    const dataHref = b.getAttribute('data-href') || b.getAttribute('data-route');
    pushUnique({
      kind: dataHref ? 'spa-route' : 'button',
      selector: selectorFor(b),
      text: (b.textContent || '').trim().slice(0, 80),
      href: dataHref,
    });
  });

  return out;
}`;

export async function collectInteractions(page: Page): Promise<Interaction[]> {
  // page.evaluate(string) は expression 評価しか行わないため、関数文字列を渡しても
  // 関数オブジェクトが返るだけで invoke されない。 IIFE で wrap する。
  // signature.ts と同じ問題を共有しているので、追加箇所が出たら helper に切り出す。
  const raw = (await page.evaluate(`(${COLLECT_SCRIPT})()`)) as Interaction[];
  return raw;
}
