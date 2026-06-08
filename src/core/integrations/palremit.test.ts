import { describe, it, expect, vi } from 'vitest';
import {
  getPalremitOfframpRates,
  getPalremitOnrampQuote,
  getPalremitOnrampRates,
  type PalremitCurrencyRequestFn,
} from '@/core/integrations/palremit';

function mockCurrencyRequest(data: { rate?: string; conversion?: number }): {
  fn: PalremitCurrencyRequestFn;
  bodies: unknown[];
} {
  const bodies: unknown[] = [];
  const fn: PalremitCurrencyRequestFn = vi.fn(async (_path, options) => {
    bodies.push(options?.body);
    return {
      status: 200,
      data: { status: 'success', data },
    };
  });
  return { fn, bodies };
}

describe('Palremit /pairs/conversion', () => {
  it('getPalremitOnrampRates sends b2b: true', async () => {
    const { fn, bodies } = mockCurrencyRequest({ rate: '1.05' });
    await getPalremitOnrampRates(fn, 'usd', 'usdt');
    expect(bodies[0]).toEqual({ from: 'USD', to: 'USDT', amount: 1, b2b: true });
  });

  it('getPalremitOnrampQuote sends b2b: true with amount', async () => {
    const { fn, bodies } = mockCurrencyRequest({ rate: '1.05', conversion: 105 });
    await getPalremitOnrampQuote(fn, 'usd', 'usdt', 100);
    expect(bodies[0]).toEqual({ from: 'USD', to: 'USDT', amount: 100, b2b: true });
  });

  it('getPalremitOfframpRates sends b2b: true', async () => {
    const { fn, bodies } = mockCurrencyRequest({ rate: '1500' });
    await getPalremitOfframpRates(fn, 'usdt', 'ngn', 'POLYGON');
    expect(bodies[0]).toEqual({ from: 'USDT', to: 'NGN', amount: 1, b2b: true });
  });
});
