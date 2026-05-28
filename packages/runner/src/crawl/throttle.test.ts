import { describe, expect, it } from 'vitest';
import type { Page } from 'playwright';
import {
  applyThrottling,
  needsThrottling,
  resolveNetworkConditions,
  type ThrottleOptions,
} from './throttle.js';

interface SentCall {
  method: string;
  params: unknown;
}

function fakePage(): { page: Page; calls: SentCall[]; sessionCount: () => number } {
  const calls: SentCall[] = [];
  let sessions = 0;
  const session = {
    send: (method: string, params: unknown) => {
      calls.push({ method, params });
      return Promise.resolve(undefined);
    },
  };
  const page = {
    context: () => ({
      newCDPSession: (_p: Page) => {
        sessions += 1;
        return Promise.resolve(session);
      },
    }),
  } as unknown as Page;
  return { page, calls, sessionCount: () => sessions };
}

describe('needsThrottling', () => {
  it('is false when nothing is throttled', () => {
    expect(needsThrottling({ networkThrottle: 'none', cpuThrottle: 1 })).toBe(false);
  });

  it('is true when network is throttled', () => {
    expect(needsThrottling({ networkThrottle: 'slow-3g', cpuThrottle: 1 })).toBe(true);
  });

  it('is true when cpu is throttled', () => {
    expect(needsThrottling({ networkThrottle: 'none', cpuThrottle: 4 })).toBe(true);
  });
});

describe('resolveNetworkConditions', () => {
  it('returns null for none', () => {
    expect(resolveNetworkConditions('none')).toBeNull();
  });

  it('marks offline preset as offline', () => {
    expect(resolveNetworkConditions('offline')).toMatchObject({ offline: true });
  });

  it('returns finite throughput / latency for slow-3g', () => {
    const c = resolveNetworkConditions('slow-3g');
    expect(c).not.toBeNull();
    expect(c!.offline).toBe(false);
    expect(c!.downloadThroughput).toBeGreaterThan(0);
    expect(c!.latency).toBeGreaterThan(0);
  });
});

describe('applyThrottling', () => {
  it('does not open a CDP session when nothing is throttled', async () => {
    const { page, calls, sessionCount } = fakePage();
    await applyThrottling(page, { networkThrottle: 'none', cpuThrottle: 1 });
    expect(sessionCount()).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('emulates network conditions for a network preset', async () => {
    const { page, calls } = fakePage();
    const opts: ThrottleOptions = { networkThrottle: 'fast-3g', cpuThrottle: 1 };
    await applyThrottling(page, opts);
    const net = calls.find((c) => c.method === 'Network.emulateNetworkConditions');
    expect(net).toBeDefined();
    expect(net!.params).toMatchObject({ offline: false });
    expect(calls.some((c) => c.method === 'Emulation.setCPUThrottlingRate')).toBe(false);
  });

  it('sets CPU throttling rate when cpuThrottle > 1', async () => {
    const { page, calls } = fakePage();
    await applyThrottling(page, { networkThrottle: 'none', cpuThrottle: 6 });
    const cpu = calls.find((c) => c.method === 'Emulation.setCPUThrottlingRate');
    expect(cpu).toBeDefined();
    expect(cpu!.params).toEqual({ rate: 6 });
    expect(calls.some((c) => c.method === 'Network.emulateNetworkConditions')).toBe(false);
  });

  it('applies both network and CPU throttling together', async () => {
    const { page, calls } = fakePage();
    await applyThrottling(page, { networkThrottle: 'slow-3g', cpuThrottle: 4 });
    const methods = calls.map((c) => c.method).sort();
    expect(methods).toEqual(['Emulation.setCPUThrottlingRate', 'Network.emulateNetworkConditions']);
  });
});
