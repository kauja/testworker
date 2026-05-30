import { z } from 'zod';

export const OriginScheme = z.enum(['http', 'https', 'any']);
export type OriginScheme = z.infer<typeof OriginScheme>;

export const OriginHostSpec = z.object({
  mode: z.enum(['exact', 'suffix', 'glob']),
  value: z.string().min(1),
});
export type OriginHostSpec = z.infer<typeof OriginHostSpec>;

export const OriginPortSpec = z.union([
  z.literal('any'),
  z.literal('same'),
  z.array(z.number().int().min(1).max(65_535)).min(1),
]);
export type OriginPortSpec = z.infer<typeof OriginPortSpec>;

export const OriginSpec = z.object({
  scheme: OriginScheme.default('any'),
  host: OriginHostSpec,
  port: OriginPortSpec.default('same'),
  allowList: z.array(z.string().url()).default([]),
  blockList: z.array(z.string().min(1)).default([]),
});
export type OriginSpec = z.infer<typeof OriginSpec>;

export type OriginScopePreset =
  | 'same-origin'
  | 'same-host'
  | 'same-host-port'
  | 'subdomains'
  | 'any';

export function originSpecForStartUrl(startUrl: string, preset: OriginScopePreset): OriginSpec {
  const url = new URL(startUrl);
  const scheme =
    url.protocol === 'http:' || url.protocol === 'https:' ? url.protocol.slice(0, -1) : 'any';
  switch (preset) {
    case 'same-origin':
      return OriginSpec.parse({
        scheme,
        host: { mode: 'exact', value: url.hostname },
        port: 'same',
      });
    case 'same-host-port':
      return OriginSpec.parse({
        scheme: 'any',
        host: { mode: 'exact', value: url.hostname },
        port: 'same',
      });
    case 'same-host':
      return OriginSpec.parse({
        scheme: 'any',
        host: { mode: 'exact', value: url.hostname },
        port: 'any',
      });
    case 'subdomains':
      return OriginSpec.parse({
        scheme: 'any',
        host: { mode: 'suffix', value: url.hostname },
        port: 'any',
      });
    case 'any':
      return OriginSpec.parse({
        scheme: 'any',
        host: { mode: 'glob', value: '*' },
        port: 'any',
      });
  }
}

export function originSpecFromLegacy(startUrl: string, sameOriginOnly: boolean): OriginSpec {
  return originSpecForStartUrl(startUrl, sameOriginOnly ? 'same-origin' : 'any');
}

export function originSpecFromCrawlOptions(options: {
  startUrl: string;
  sameOriginOnly: boolean;
  originSpec?: OriginSpec;
}): OriginSpec {
  return options.originSpec ?? originSpecFromLegacy(options.startUrl, options.sameOriginOnly);
}

export function parseStoredOriginSpec(raw: string, entryUrl: string): OriginSpec {
  try {
    const parsed = OriginSpec.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // Legacy rows stored the URL origin directly in this column.
  }
  try {
    const origin = new URL(raw);
    return OriginSpec.parse({
      scheme:
        origin.protocol === 'http:' || origin.protocol === 'https:'
          ? origin.protocol.slice(0, -1)
          : 'any',
      host: { mode: 'exact', value: origin.hostname },
      port: 'same',
    });
  } catch {
    try {
      return originSpecForStartUrl(entryUrl, 'same-origin');
    } catch {
      return OriginSpec.parse({
        scheme: 'any',
        host: { mode: 'glob', value: '*' },
        port: 'any',
      });
    }
  }
}

export function serializeOriginSpec(spec: OriginSpec): string {
  return JSON.stringify(OriginSpec.parse(spec));
}
