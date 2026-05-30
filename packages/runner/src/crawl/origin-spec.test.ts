import { describe, expect, it } from 'vitest';
import { originSpecForStartUrl, OriginSpec } from '@testworker/shared';
import { isAllowedOrigin } from './origin-spec.js';

describe('isAllowedOrigin', () => {
  const start = 'http://localhost:3000/';

  it('keeps legacy same-origin behavior for generated strict specs', () => {
    const spec = originSpecForStartUrl(start, 'same-origin');
    expect(isAllowedOrigin('http://localhost:3000/a', spec, start)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173/a', spec, start)).toBe(false);
    expect(isAllowedOrigin('https://localhost:3000/a', spec, start)).toBe(false);
  });

  it('allows localhost port changes with the same-host preset', () => {
    const spec = originSpecForStartUrl(start, 'same-host');
    expect(isAllowedOrigin('http://localhost:5173/storybook', spec, start)).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:5173/storybook', spec, start)).toBe(false);
  });

  it('keeps the start port with the same-host-port preset', () => {
    const spec = originSpecForStartUrl(start, 'same-host-port');
    expect(isAllowedOrigin('https://localhost:3000/a', spec, start)).toBe(true);
    expect(isAllowedOrigin('http://localhost:5173/a', spec, start)).toBe(false);
  });

  it('allows the root domain and subdomains with suffix host mode', () => {
    const spec = originSpecForStartUrl('https://example.com', 'subdomains');
    expect(isAllowedOrigin('https://example.com/a', spec, 'https://example.com')).toBe(true);
    expect(isAllowedOrigin('https://app.example.com/a', spec, 'https://example.com')).toBe(true);
    expect(isAllowedOrigin('https://evil-example.com/a', spec, 'https://example.com')).toBe(false);
  });

  it('supports glob host mode', () => {
    const spec = OriginSpec.parse({
      scheme: 'https',
      host: { mode: 'glob', value: '*.example.com' },
      port: 'any',
    });
    expect(isAllowedOrigin('https://docs.example.com/a', spec, 'https://app.example.com')).toBe(
      true,
    );
    expect(isAllowedOrigin('https://example.com/a', spec, 'https://app.example.com')).toBe(false);
    expect(isAllowedOrigin('http://docs.example.com/a', spec, 'https://app.example.com')).toBe(
      false,
    );
  });

  it('supports explicit port allow lists', () => {
    const spec = OriginSpec.parse({
      scheme: 'any',
      host: { mode: 'exact', value: 'localhost' },
      port: [3000, 5173],
    });
    expect(isAllowedOrigin('http://localhost:5173/a', spec, start)).toBe(true);
    expect(isAllowedOrigin('http://localhost:6006/a', spec, start)).toBe(false);
  });

  it('treats default http and https ports as effective ports', () => {
    const httpSpec = OriginSpec.parse({
      scheme: 'http',
      host: { mode: 'exact', value: 'example.com' },
      port: [80],
    });
    const httpsSpec = OriginSpec.parse({
      scheme: 'https',
      host: { mode: 'exact', value: 'example.com' },
      port: [443],
    });
    expect(isAllowedOrigin('http://example.com/a', httpSpec, 'http://example.com')).toBe(true);
    expect(isAllowedOrigin('https://example.com/a', httpsSpec, 'https://example.com')).toBe(true);
  });

  it('lets allowList include auth origins outside the host rule', () => {
    const spec = OriginSpec.parse({
      scheme: 'https',
      host: { mode: 'exact', value: 'app.example.com' },
      port: 'same',
      allowList: ['https://auth.example.com'],
    });
    expect(isAllowedOrigin('https://auth.example.com/login', spec, 'https://app.example.com')).toBe(
      true,
    );
  });

  it('lets blockList override both scope and allowList', () => {
    const spec = OriginSpec.parse({
      scheme: 'https',
      host: { mode: 'suffix', value: 'example.com' },
      port: 'any',
      allowList: ['https://auth.example.com'],
      blockList: ['https://auth.example.com/private', '/admin'],
    });
    expect(isAllowedOrigin('https://auth.example.com/private', spec, 'https://example.com')).toBe(
      false,
    );
    expect(
      isAllowedOrigin('https://app.example.com/admin/users', spec, 'https://example.com'),
    ).toBe(false);
    expect(isAllowedOrigin('https://app.example.com/dashboard', spec, 'https://example.com')).toBe(
      true,
    );
  });

  it('rejects malformed URLs', () => {
    const spec = originSpecForStartUrl(start, 'same-host');
    expect(isAllowedOrigin('not a url', spec, start)).toBe(false);
  });
});
