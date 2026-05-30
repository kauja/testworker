import { createHash } from 'node:crypto';
import vm from 'node:vm';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { computeNavHash, computeSignature, NAV_SCRIPT, STRUCTURE_SCRIPT } from './signature.js';

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[];
  readonly attrs: Record<string, string>;

  constructor(tagName: string, attrs: Record<string, string> = {}, children: FakeElement[] = []) {
    this.tagName = tagName.toUpperCase();
    this.attrs = attrs;
    this.children = children;
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null;
  }

  hasAttribute(name: string): boolean {
    return this.attrs[name] !== undefined;
  }

  getBoundingClientRect(): { width: number; height: number } {
    return {
      width: Number(this.attrs['data-width'] ?? 100),
      height: Number(this.attrs['data-height'] ?? 100),
    };
  }

  querySelectorAll(selector: string): FakeElement[] {
    return flatten(this).filter((element) => matchesAny(element, selector));
  }
}

const el = (tag: string, attrs: Record<string, string> = {}, children: FakeElement[] = []) =>
  new FakeElement(tag, attrs, children);

function flatten(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(flatten)];
}

function matches(element: FakeElement, selector: string): boolean {
  if (selector === 'body *') return element.tagName.toLowerCase() !== 'body';
  if (selector === '[role="dialog"]') return element.getAttribute('role') === 'dialog';
  if (selector === '[role="alertdialog"]') return element.getAttribute('role') === 'alertdialog';
  if (selector === '[role="alert"]') return element.getAttribute('role') === 'alert';
  if (selector === '[role="status"]') return element.getAttribute('role') === 'status';
  if (selector === '[aria-modal="true"]') return element.getAttribute('aria-modal') === 'true';
  if (selector === '[aria-expanded="true"]')
    return element.getAttribute('aria-expanded') === 'true';
  if (selector === 'dialog[open]') {
    return element.tagName.toLowerCase() === 'dialog' && element.hasAttribute('open');
  }
  if (selector === '[role=main]') return element.getAttribute('role') === 'main';
  if (selector === '[role=navigation]') return element.getAttribute('role') === 'navigation';
  if (selector === '[role=button]') return element.getAttribute('role') === 'button';
  if (selector === '[role=link]') return element.getAttribute('role') === 'link';
  return element.tagName.toLowerCase() === selector;
}

function matchesAny(element: FakeElement, selector: string): boolean {
  return selector.split(',').some((part) => matches(element, part.trim()));
}

function runStructureScript(body: FakeElement) {
  const all = flatten(body);
  const context = {
    Array,
    Math,
    Set,
    document: {
      body,
      documentElement: { scrollHeight: 900 },
      querySelectorAll: (selector: string) =>
        all.filter((element) => matchesAny(element, selector)),
    },
    getComputedStyle: (element: FakeElement) => ({
      visibility: element.attrs['data-visibility'] ?? 'visible',
      display: element.attrs['data-display'] ?? 'block',
      opacity: element.attrs['data-opacity'] ?? '1',
      position: element.attrs['data-position'] ?? 'static',
      zIndex: element.attrs['data-z'] ?? '0',
    }),
    window: { innerWidth: 1000, innerHeight: 800 },
    location: { pathname: '/docs', search: '?q=1', hash: '#intro' },
  };
  return vm.runInNewContext(`(${STRUCTURE_SCRIPT})()`, context) as {
    tokens: string;
    pathname: string;
    search: string;
    hash: string;
    scrollH: number;
  };
}

function runNavScript(body: FakeElement, hash = '#intro') {
  const all = flatten(body);
  const context = {
    Array,
    Set,
    document: {
      body,
      querySelectorAll: (selector: string) => all.filter((element) => matches(element, selector)),
    },
    location: { pathname: '/docs', search: '?q=1', hash },
  };
  return vm.runInNewContext(`(${NAV_SCRIPT})()`, context) as {
    tokens: string;
    pathname: string;
    search: string;
  };
}

describe('STRUCTURE_SCRIPT', () => {
  it('keeps stable attributes and filters unstable dynamic ids', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('main', { id: 'app-shell', role: 'main' }, [
          el('button', {
            id: 'user-12345',
            'data-testid': 'save-button',
            'aria-label': 'Save current item',
          }),
        ]),
      ]),
    );

    expect(dom.tokens).toContain('main[id=app-shell,role=main]');
    expect(dom.tokens).toContain('button[data-testid=save-button,aria-label=Save current item]');
    expect(dom.tokens).not.toContain('id=user-12345');
  });

  it('uses landmarks instead of hashing the whole body when landmarks exist', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('section', { id: 'marketing-copy' }),
        el('nav', { 'aria-label': 'Primary' }, [el('a', { name: 'home' })]),
      ]),
    );

    expect(dom.tokens).toBe('nav[aria-label=Primary]{a[name=home]}');
    expect(dom.tokens).not.toContain('section');
  });

  it('includes role dialog overlays outside landmarks', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('main', {}, [el('button', { 'data-testid': 'open' })]),
        el('div', { role: 'dialog', 'aria-label': 'Password reset' }, [
          el('button', { 'aria-label': 'Close' }),
        ]),
      ]),
    );

    expect(dom.tokens).toContain('overlays{dialog:');
    expect(dom.tokens).toContain('div[role=dialog,aria-label=Password reset]');
  });

  it('includes alert and status overlays while ignoring dynamic text', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('main'),
        el('div', { role: 'alert', 'data-testid': 'toast' }, [el('span')]),
        el('div', { role: 'status', 'aria-label': 'Saving' }),
      ]),
    );

    expect(dom.tokens).toContain('alert:div[role=alert,data-testid=toast]');
    expect(dom.tokens).toContain('alert:div[role=status,aria-label=Saving]');
    expect(dom.tokens).not.toContain('Saving...');
  });

  it('includes open dialog elements', () => {
    const dom = runStructureScript(el('body', {}, [el('main'), el('dialog', { open: '' })]));

    expect(dom.tokens).toContain('dialog:dialog');
  });

  it('classifies fixed high z-index viewport overlays', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('main'),
        el('div', {
          'data-position': 'fixed',
          'data-z': '1200',
          'data-width': '900',
          'data-height': '600',
          'data-testid': 'drawer',
        }),
      ]),
    );

    expect(dom.tokens).toContain('drawer:div[data-testid=drawer]');
  });

  it('ignores invisible and low z-index non overlays', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('main'),
        el('div', { role: 'dialog', 'data-display': 'none', 'data-testid': 'hidden-dialog' }),
        el('div', { 'data-position': 'fixed', 'data-z': '10', 'data-testid': 'banner' }),
      ]),
    );

    expect(dom.tokens).not.toContain('hidden-dialog');
    expect(dom.tokens).not.toContain('banner');
    expect(dom.tokens).not.toContain('overlays{');
  });

  it('cuts off DOM tokenization after the configured depth', () => {
    const dom = runStructureScript(
      el('body', {}, [
        el('main', {}, [
          el('section', {}, [
            el('div', {}, [
              el('div', {}, [el('div', {}, [el('div', {}, [el('span', {}, [el('strong')])])])]),
            ]),
          ]),
        ]),
      ]),
    );

    expect(dom.tokens).toContain('span');
    expect(dom.tokens).not.toContain('strong');
  });
});

describe('computeSignature', () => {
  it('combines URL pieces with a deterministic structure hash', async () => {
    const tokens = 'main[id=app]{button[data-testid=save]}';
    const expectedHash = createHash('sha1').update(tokens).digest('hex').slice(0, 16);
    const navHash = createHash('sha1').update('/docs?q=1|').digest('hex').slice(0, 16);
    const page = {
      url: () => 'https://example.com/docs?q=1#intro',
      title: () => Promise.resolve('Docs'),
      evaluate: (source: string) => {
        if (source.includes('scrollH')) {
          return Promise.resolve({
            tokens,
            pathname: '/docs',
            search: '?q=1',
            hash: '#intro',
            scrollH: 1200,
          });
        }
        return Promise.resolve({ tokens: '', pathname: '/docs', search: '?q=1' });
      },
    } as unknown as Page;

    await expect(computeSignature(page)).resolves.toEqual({
      signature: `/docs?q=1#intro#${expectedHash}`,
      url: 'https://example.com/docs?q=1#intro',
      pathname: '/docs',
      title: 'Docs',
      navHash,
      structureHash: expectedHash,
    });
  });

  it('keeps hash-only SPA URL changes in the same nav hash', async () => {
    const nav = el('body', {}, [
      el('nav', { 'aria-label': 'Primary' }, [el('a', { name: 'home' })]),
    ]);
    const page = {
      evaluate: () => Promise.resolve(runNavScript(nav, '#settings')),
    } as unknown as Page;
    const first = await computeNavHash(page);
    const secondNav = runNavScript(nav, '#billing');
    const second = createHash('sha1')
      .update(`${secondNav.pathname}${secondNav.search}|${secondNav.tokens}`)
      .digest('hex')
      .slice(0, 16);

    expect(first).toBe(second);
  });

  it('separates the same URL when navigation landmarks differ', async () => {
    const first = runNavScript(el('body', {}, [el('nav', {}, [el('a', { name: 'home' })])]));
    const second = runNavScript(el('body', {}, [el('nav', {}, [el('a', { name: 'billing' })])]));

    const firstHash = createHash('sha1')
      .update(`${first.pathname}${first.search}|${first.tokens}`)
      .digest('hex')
      .slice(0, 16);
    const secondHash = createHash('sha1')
      .update(`${second.pathname}${second.search}|${second.tokens}`)
      .digest('hex')
      .slice(0, 16);

    expect(firstHash).not.toBe(secondHash);
  });

  it('separates same-screen states when body structure changes', async () => {
    const buttonHash = createHash('sha1')
      .update(
        runStructureScript(el('body', {}, [el('main', {}, [el('button', { name: 'save' })])]))
          .tokens,
      )
      .digest('hex')
      .slice(0, 16);
    const formHash = createHash('sha1')
      .update(
        runStructureScript(el('body', {}, [el('main', {}, [el('form', { name: 'save' })])])).tokens,
      )
      .digest('hex')
      .slice(0, 16);

    expect(buttonHash).not.toBe(formHash);
  });
});
