import type { OriginSpec } from '@testworker/shared';

export function isAllowedOrigin(url: string, originSpec: OriginSpec, startUrl: string): boolean {
  let target: URL;
  let start: URL;
  try {
    target = new URL(url);
    start = new URL(startUrl);
  } catch {
    return false;
  }

  if (isBlocked(target, originSpec.blockList)) return false;
  if (isAllowListed(target, originSpec.allowList)) return true;

  if (originSpec.scheme !== 'any' && target.protocol !== `${originSpec.scheme}:`) return false;
  if (!hostMatches(target.hostname, originSpec.host)) return false;
  if (!portMatches(target, start, originSpec.port)) return false;
  return true;
}

function hostMatches(hostname: string, spec: OriginSpec['host']): boolean {
  const host = hostname.toLowerCase();
  const value = spec.value.toLowerCase();
  switch (spec.mode) {
    case 'exact':
      return host === value;
    case 'suffix':
      return host === value || host.endsWith(`.${value}`);
    case 'glob':
      return globToRegExp(value).test(host);
  }
}

function portMatches(target: URL, start: URL, spec: OriginSpec['port']): boolean {
  if (spec === 'any') return true;
  const targetPort = effectivePort(target);
  if (spec === 'same') return targetPort === effectivePort(start);
  return spec.includes(targetPort);
}

function isAllowListed(target: URL, allowList: string[]): boolean {
  return allowList.some((entry) => urlEntryMatches(target, entry));
}

function isBlocked(target: URL, blockList: string[]): boolean {
  return blockList.some((entry) => {
    const trimmed = entry.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('/')) return target.pathname.startsWith(trimmed);
    if (urlEntryMatches(target, trimmed)) return true;
    return target.href.startsWith(trimmed) || target.origin === trimmed;
  });
}

function urlEntryMatches(target: URL, entry: string): boolean {
  try {
    const allowed = new URL(entry);
    if (target.origin !== allowed.origin) return false;
    const path = allowed.pathname === '/' ? '' : allowed.pathname;
    if (!path && !allowed.search) return true;
    return target.href.startsWith(allowed.toString());
  } catch {
    return false;
  }
}

function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'http:' ? 80 : url.protocol === 'https:' ? 443 : 0;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}$`, 'i');
}
