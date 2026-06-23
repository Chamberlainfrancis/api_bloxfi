import { describe, it, expect, vi } from 'vitest';
import { computeRateSpreadProfit, buildPalremitProfit } from '@/core/quotes/rateSpread';

describe('computeRateSpreadProfit', () => {
  it('offramp orientation (output === rateCurrency → multiply)', () => {
    const r = computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'eur', rate: 0.86764954, marketRate: 0.86904,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    });
    expect(r?.currency).toBe('eur');
    expect(r?.amount).toBeCloseTo(0.139046, 5); // 100×0.86904 − 100×0.86764954
  });

  it('onramp orientation (output === perCurrency → divide)', () => {
    const r = computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'usdt', rate: 0.87043046, marketRate: 0.86904,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    });
    expect(r?.amount).toBeCloseTo(0.18379, 4); // 100/0.86904 − 100/0.87043046
  });

  it('clamps a negative spread to 0', () => {
    const r = computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'eur', rate: 0.90, marketRate: 0.86904,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    });
    expect(r?.amount).toBe(0);
  });

  it('returns null when toCurrency matches neither orientation side', () => {
    expect(computeRateSpreadProfit({
      sourceAmount: 100, toCurrency: 'gbp', rate: 1, marketRate: 1.1,
      rateCurrency: 'EUR', perCurrency: 'USDT',
    })).toBeNull();
  });

  it('returns null on non-finite/zero inputs', () => {
    expect(computeRateSpreadProfit({
      sourceAmount: 0, toCurrency: 'eur', rate: 1, marketRate: 1.1, rateCurrency: 'EUR', perCurrency: 'USDT',
    })).toBeNull();
  });
});

describe('buildPalremitProfit', () => {
  const base = {
    sourceAmount: 100, toCurrency: 'eur', rate: '0.86764954', marketRate: '0.86904',
    rateCurrency: 'EUR', perCurrency: 'USDT', nowIso: '2026-06-23T00:00:00.000Z',
  };

  it('builds a full record and normalizes to USDC via convertToUsdc', async () => {
    const convertToUsdc = vi.fn(async () => 0.159);
    const p = await buildPalremitProfit({ ...base, convertToUsdc });
    expect(p?.currency).toBe('eur');
    expect(p?.amountInCurrency).toBe('0.13904600');
    expect(p?.customerRate).toBe('0.86764954');
    expect(p?.marketRate).toBe('0.86904');
    expect(p?.amountUsdc).toBe('0.15900000');
    expect(convertToUsdc).toHaveBeenCalledWith('EUR', expect.any(Number));
  });

  it('skips conversion when profit currency is USDC', async () => {
    const convertToUsdc = vi.fn(async () => null);
    const p = await buildPalremitProfit({ ...base, toCurrency: 'usdc', perCurrency: 'USDC', convertToUsdc });
    expect(convertToUsdc).not.toHaveBeenCalled();
    expect(p?.amountUsdc).not.toBeNull();
  });

  it('returns amountUsdc null (native retained) when conversion unavailable', async () => {
    const p = await buildPalremitProfit({ ...base, convertToUsdc: async () => null });
    expect(p?.amountUsdc).toBeNull();
    expect(p?.amountInCurrency).toBe('0.13904600');
  });

  it('returns null when marketRate missing', async () => {
    const p = await buildPalremitProfit({ ...base, marketRate: undefined, convertToUsdc: async () => 1 });
    expect(p).toBeNull();
  });

  it('returns null when rate is unparseable (NaN guard)', async () => {
    const p = await buildPalremitProfit({ ...base, rate: 'garbage', convertToUsdc: async () => 1 });
    expect(p).toBeNull();
  });

  it('returns null when rateCurrency is undefined', async () => {
    const p = await buildPalremitProfit({ ...base, rateCurrency: undefined, convertToUsdc: async () => 1 });
    expect(p).toBeNull();
  });

  it('returns null when perCurrency is undefined', async () => {
    const p = await buildPalremitProfit({ ...base, perCurrency: undefined, convertToUsdc: async () => 1 });
    expect(p).toBeNull();
  });

  it('zero/negative spread returns non-null with zero amounts', async () => {
    // rate > marketRate in offramp orientation → spread is negative, clamped to 0
    const p = await buildPalremitProfit({
      ...base,
      rate: '0.90',
      marketRate: '0.86904',
      convertToUsdc: async () => 1,
    });
    expect(p).not.toBeNull();
    expect(p?.amountUsdc).toBe('0.00000000');
    expect(p?.amountInCurrency).toBe('0.00000000');
  });
});
