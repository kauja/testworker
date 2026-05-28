import { createHash } from 'node:crypto';
import vm from 'node:vm';
import type { Page } from 'playwright';
import { describe, expect, it } from 'vitest';
import { computeSignature, STRUCTURE_SCRIPT } from './signature.js';

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
}

const el = (tag: string, attrs: Record<string, string> = {}, children: FakeElement[] = []) =>
  new FakeElement(tag, attrs, children);

function flatten(root: FakeElement): FakeElement[] {
  return [root, ...root.children.flatMap(flatten)];
}

function matches(element: FakeElement, selector: string): boolean {
  if (selector === '[role=main]') return element.getAttribute('role') === 'main';
  if (selector === '[role=navigation]') return element.getAttribute('role') === 'navigation';
  return element.tagName.toLowerCase() === selector;
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
      querySelectorAll: (selector: string) => all.filter((element) => matches(element, selector)),
    },
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
    const page = {
      url: () => 'https://example.com/docs?q=1#intro',
      title: () => Promise.resolve('Docs'),
      evaluate: () =>
        Promise.resolve({
          tokens,
          pathname: '/docs',
          search: '?q=1',
          hash: '#intro',
          scrollH: 1200,
        }),
    } as unknown as Page;

    await expect(computeSignature(page)).resolves.toEqual({
      signature: `/docs?q=1#intro#${expectedHash}`,
      url: 'https://example.com/docs?q=1#intro',
      pathname: '/docs',
      title: 'Docs',
      structureHash: expectedHash,
    });
  });
});
