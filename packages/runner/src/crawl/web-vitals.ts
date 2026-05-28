import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from 'playwright';
import { log, PageMetrics as PageMetricsSchema, type PageMetrics } from '@testworker/shared';

const require = createRequire(import.meta.url);
const WEB_VITALS_IIFE_PATH = join(dirname(require.resolve('web-vitals')), 'web-vitals.iife.js');
const WEB_VITALS_IIFE_SOURCE = `${readFileSync(WEB_VITALS_IIFE_PATH, 'utf8')}
;globalThis.webVitals = webVitals;`;

const INSTALL_COLLECTOR_SCRIPT = `
(() => {
  const target = globalThis;
  const metrics = (target.__testworkerWebVitals = target.__testworkerWebVitals || {});
  const assign = (metric) => {
    const key = String(metric.name || '').toLowerCase();
    if (key === 'lcp' || key === 'cls' || key === 'inp' || key === 'ttfb' || key === 'fcp') {
      metrics[key] = typeof metric.value === 'number' ? metric.value : null;
    }
  };
  const api = target.webVitals;
  if (!api) return;
  api.onLCP(assign, { reportAllChanges: true });
  api.onCLS(assign, { reportAllChanges: true });
  api.onINP(assign, { reportAllChanges: true });
  api.onTTFB(assign, { reportAllChanges: true });
  api.onFCP(assign, { reportAllChanges: true });
})();
`;

const READ_METRICS_SCRIPT = `
(() => {
  const raw = globalThis.__testworkerWebVitals || {};
  const metric = (key) => (typeof raw[key] === 'number' && Number.isFinite(raw[key]) ? raw[key] : null);
  return {
    lcp: metric('lcp'),
    cls: metric('cls'),
    inp: metric('inp'),
    ttfb: metric('ttfb'),
    fcp: metric('fcp'),
  };
})()
`;

export async function installWebVitals(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: WEB_VITALS_IIFE_SOURCE });
  await context.addInitScript({ content: INSTALL_COLLECTOR_SCRIPT });
}

export async function collectWebVitals(page: Page): Promise<PageMetrics> {
  try {
    const raw = await page.evaluate(READ_METRICS_SCRIPT);
    const parsed = PageMetricsSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'web vitals collection failed');
    return {};
  }
}
