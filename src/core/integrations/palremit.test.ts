import { describe, it, expect, vi } from 'vitest';
import {
  getPalremitOfframpRates,
  getPalremitOnrampQuote,
  getPalremitOnrampRates,
  getPalremitConversionAmount,
  type PalremitCurrencyRequestFn,
} from '@/core/integrations/palremit';

function mockCurrencyRequest(data: { rate?: string; conversion?: number; marketRate?: string; rateCurrency?: string; perCurrency?: string }): {
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

describe('marketRate + orientation capture', () => {
  it('surfaces marketRate/rateCurrency/perCurrency on offramp rates', async () => {
    const { fn } = mockCurrencyRequest({ rate: '0.86764954', marketRate: '0.86904', rateCurrency: 'EUR', perCurrency: 'USDT' });
    const r = await getPalremitOfframpRates(fn, 'usdt', 'eur');
    expect(r?.marketRate).toBe('0.86904');
    expect(r?.rateCurrency).toBe('EUR');
    expect(r?.perCurrency).toBe('USDT');
  });

  it('surfaces marketRate on the onramp quote', async () => {
    const { fn } = mockCurrencyRequest({ rate: '0.87043046', conversion: 1.14885685, marketRate: '0.86904', rateCurrency: 'EUR', perCurrency: 'USDT' });
    const r = await getPalremitOnrampQuote(fn, 'eur', 'usdt', 1);
    expect(r?.marketRate).toBe('0.86904');
    expect(r?.rateCurrency).toBe('EUR');
    expect(r?.perCurrency).toBe('USDT');
  });

  it('getPalremitConversionAmount returns the conversion field', async () => {
    const { fn } = mockCurrencyRequest({ rate: '0.8733852', conversion: 0.15915085, marketRate: '0.86904', rateCurrency: 'EUR', perCurrency: 'USDC' });
    const amt = await getPalremitConversionAmount(fn, 'eur', 'usdc', 0.139);
    expect(amt).toBeCloseTo(0.15915085, 6);
  });

  it('getPalremitConversionAmount returns null on failure', async () => {
    const fn = (async () => ({ status: 500, data: { status: 'error', data: null } })) as never;
    expect(await getPalremitConversionAmount(fn, 'eur', 'usdc', 1)).toBeNull();
  });

  it('surfaces marketRate/rateCurrency/perCurrency on onramp rates', async () => {
    const { fn } = mockCurrencyRequest({ rate: '1450', marketRate: '1460', rateCurrency: 'NGN', perCurrency: 'USDT' });
    const r = await getPalremitOnrampRates(fn, 'ngn', 'usdt');
    expect(r?.marketRate).toBe('1460');
    expect(r?.rateCurrency).toBe('NGN');
    expect(r?.perCurrency).toBe('USDT');
  });
});

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
