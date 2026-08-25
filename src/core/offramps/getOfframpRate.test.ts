import { describe, it, expect, vi } from 'vitest';
import { getOfframpRate } from '@/core/offramps/getOfframpRate';

describe('getOfframpRate — pair markup', () => {
  it('applies 25 bps below marketRate for USDT → EUR', async () => {
    const result = await getOfframpRate('usdt', 'eur', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        conversionRate: '0.871',
        inverseRate: String(1 / 0.871),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '10',
        maximumAmount: '100000',
        estimatedProcessingTime: '1-3 business days',
        marketRate: '0.87',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
    });
    const customer = 0.87 * 0.9975;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
    expect(Number(result.inverseRate)).toBeCloseTo(1 / customer, 10);
  });

  it('keeps the B2B rate for USDT → NGN', async () => {
    const result = await getOfframpRate('usdt', 'ngn', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'ngn',
        conversionRate: '1450',
        inverseRate: String(1 / 1450),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '10',
        maximumAmount: '100000',
        estimatedProcessingTime: '1-3 business days',
        marketRate: '1460',
        rateCurrency: 'NGN',
        perCurrency: 'USDT',
      })),
    });
    expect(result.conversionRate).toBe('1450');
  });
});
