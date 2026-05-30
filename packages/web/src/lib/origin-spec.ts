import type { OriginSpec } from '@testworker/shared';

export type WebScopePreset = 'same-host' | 'same-host-port' | 'subdomains';

export function formatOriginSpec(spec: OriginSpec): string {
  const scheme = spec.scheme === 'any' ? '*' : spec.scheme;
  const port = spec.port === 'any' ? '*' : spec.port === 'same' ? 'same-port' : spec.port.join(',');
  return `${scheme}://${spec.host.mode}:${spec.host.value}:${port}`;
}

export function prettyOriginSpec(spec: OriginSpec): string {
  return JSON.stringify(spec, null, 2);
}

export function webOriginSpecForStartUrl(startUrl: string, preset: WebScopePreset): OriginSpec {
  const url = new URL(startUrl);
  if (preset === 'same-host') {
    return {
      scheme: 'any',
      host: { mode: 'exact', value: url.hostname },
      port: 'any',
      allowList: [],
      blockList: [],
    };
  }
  if (preset === 'same-host-port') {
    return {
      scheme: 'any',
      host: { mode: 'exact', value: url.hostname },
      port: 'same',
      allowList: [],
      blockList: [],
    };
  }
  return {
    scheme: 'any',
    host: { mode: 'suffix', value: url.hostname },
    port: 'any',
    allowList: [],
    blockList: [],
  };
}

export function parseOriginSpecJson(raw: string): OriginSpec {
  const value = JSON.parse(raw) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('OriginSpec must be an object');
  }
  const spec = value as Partial<OriginSpec>;
  const scheme = spec.scheme ?? 'any';
  const port = spec.port ?? 'same';
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'any') {
    throw new Error('Invalid scheme');
  }
  if (
    !spec.host ||
    (spec.host.mode !== 'exact' && spec.host.mode !== 'suffix' && spec.host.mode !== 'glob') ||
    typeof spec.host.value !== 'string' ||
    spec.host.value.trim() === ''
  ) {
    throw new Error('Invalid host');
  }
  if (
    port !== 'any' &&
    port !== 'same' &&
    !(
      Array.isArray(port) &&
      port.length > 0 &&
      port.every(
        (portNumber) => Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65_535,
      )
    )
  ) {
    throw new Error('Invalid port');
  }
  const allowList = Array.isArray(spec.allowList) ? spec.allowList : [];
  const blockList = Array.isArray(spec.blockList) ? spec.blockList : [];
  if (!allowList.every((url) => typeof url === 'string' && isUrl(url))) {
    throw new Error('Invalid allowList');
  }
  if (!blockList.every((entry) => typeof entry === 'string' && entry.trim() !== '')) {
    throw new Error('Invalid blockList');
  }
  return {
    scheme,
    host: spec.host,
    port,
    allowList,
    blockList,
  };
}

function isUrl(raw: string): boolean {
  try {
    new URL(raw);
    return true;
  } catch {
    return false;
  }
}
