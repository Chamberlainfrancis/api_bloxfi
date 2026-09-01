import { describe, it, expect, vi } from 'vitest';
import { getOfframpRate } from '@/core/offramps/getOfframpRate';

describe('getOfframpRate — pair markup', () => {
  it('applies 0.5% below marketRate for USDT → EUR', async () => {
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
    const customer = 0.87 * 0.995;
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

  it('floors EUR at OwlPay then takes 0.5% so the customer rate is below OwlPay', async () => {
    const result = await getOfframpRate('usdt', 'eur', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        conversionRate: '0.856314',
        inverseRate: String(1 / 0.856314),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '10',
        maximumAmount: '100000',
        estimatedProcessingTime: '1-3 business days',
        marketRate: '0.85846',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      executableRate: 0.855,
    });
    const customer = 0.855 * 0.995;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
    expect(Number(result.conversionRate)).toBeLessThan(0.855);
  });

  it('floors USDT → CNY at OwlPay when there is no pair markup', async () => {
    const result = await getOfframpRate('usdt', 'cny', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'cny',
        conversionRate: '6.6956196',
        inverseRate: String(1 / 6.6956196),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '10',
        maximumAmount: '100000',
        estimatedProcessingTime: '1-3 business days',
        marketRate: '6.703664',
        rateCurrency: 'CNY',
        perCurrency: 'USDT',
      })),
      executableRate: 6.2,
    });
    expect(Number(result.conversionRate)).toBeCloseTo(6.2, 10);
    expect(Number(result.inverseRate)).toBeCloseTo(1 / 6.2, 10);
  });

  it('refuses EUR when an executable rate is required but missing', async () => {
    await expect(
      getOfframpRate('usdt', 'eur', 'TRC20', {
        getRateFromPalremit: vi.fn(async () => ({
          fromCurrency: 'usdt',
          toCurrency: 'eur',
          conversionRate: '0.856314',
          inverseRate: String(1 / 0.856314),
          rateValidUntil: new Date().toISOString(),
          minimumAmount: '10',
          maximumAmount: '100000',
          estimatedProcessingTime: '1-3 business days',
          marketRate: '0.85846',
          rateCurrency: 'EUR',
          perCurrency: 'USDT',
        })),
        requireExecutable: true,
      })
    ).rejects.toThrow('PALREMIT_RATES_UNAVAILABLE');
  });
});
