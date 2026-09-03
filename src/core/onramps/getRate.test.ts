import { describe, it, expect, vi } from 'vitest';
import { getOnrampRate } from '@/core/onramps/getRate';

describe('getOnrampRate — pair markup', () => {
  it('applies 2.4% on marketRate for EUR → USDT', async () => {
    const result = await getOnrampRate('eur', 'usdt', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'eur',
        toCurrency: 'usdt',
        conversionRate: '0.871',
        marketRate: '0.87',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
    });
    expect(Number(result.conversionRate)).toBeCloseTo(0.87 * 1.024, 10);
    expect(result.marketRate).toBe('0.87');
  });

  it('keeps the B2B rate for USD → USDT', async () => {
    const result = await getOnrampRate('usd', 'usdt', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usd',
        toCurrency: 'usdt',
        conversionRate: '1',
        marketRate: '1',
        rateCurrency: 'USD',
        perCurrency: 'USDT',
      })),
    });
    expect(result.conversionRate).toBe('1');
  });

  it('applies 0.5% on marketRate for CAD → USDT', async () => {
    const result = await getOnrampRate('cad', 'usdt', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'cad',
        toCurrency: 'usdt',
        conversionRate: '1.38',
        marketRate: '1.375',
        rateCurrency: 'CAD',
        perCurrency: 'USDT',
      })),
    });
    expect(Number(result.conversionRate)).toBeCloseTo(1.375 * 1.005, 10);
    expect(result.marketRate).toBe('1.375');
  });
});
