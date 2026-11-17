import { describe, it, expect, vi } from 'vitest';
import { getOfframpRate } from '@/core/offramps/getOfframpRate';
import {
  _resetPairMarkupRulesForTests,
  setPairMarkupRulesFromSettings,
} from '@/core/quotes/pairMarkupStore';
import { TEST_PAIR_MARKUP_ROWS } from '@/test/pairMarkupFixture';

function withSellRow(fiat: string, markupBps: number, requireProviderRate = false): void {
  setPairMarkupRulesFromSettings([
    ...TEST_PAIR_MARKUP_ROWS,
    { fiat, side: 'sell', cryptos: 'USD,USDT,USDC', markupBps, requireProviderRate },
  ]);
}

describe('getOfframpRate — pair markup', () => {
  it('applies 20 bps below marketRate for USDT → EUR', async () => {
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
    const customer = 0.87 * 0.998;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
    expect(Number(result.inverseRate)).toBeCloseTo(1 / customer, 10);
  });

  it('refuses USDT → NGN when no sell markup is saved', async () => {
    await expect(getOfframpRate('usdt', 'ngn', 'TRC20', {
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
    })).rejects.toThrow('RATE_MARKUP_NOT_SET');
  });

  it('refuses every offramp before the markup table has loaded', async () => {
    _resetPairMarkupRulesForTests();
    await expect(
      getOfframpRate('usdt', 'eur', 'TRC20', { getRateFromPalremit: vi.fn(async () => null) })
    ).rejects.toThrow('PALREMIT_RATES_UNAVAILABLE');
  });

  it('prices USDT → NGN at market − 20 bps once a row is saved (no provider rate needed)', async () => {
    withSellRow('NGN', 20);
    const result = await getOfframpRate('usdt', 'ngn', 'TRC20', {
      requireExecutable: true,
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
    expect(Number(result.conversionRate)).toBeCloseTo(1460 * 0.998, 8);
  });

  it('floors EUR at OwlPay then takes 20 bps so the customer rate is below OwlPay', async () => {
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
    const customer = 0.855 * 0.998;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
    expect(Number(result.conversionRate)).toBeLessThan(0.855);
  });

  it('applies 0.5% below marketRate for USDT → JPY', async () => {
    const result = await getOfframpRate('usdt', 'jpy', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'jpy',
        conversionRate: '154',
        inverseRate: String(1 / 154),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '1000',
        maximumAmount: '46853070',
        estimatedProcessingTime: '1-2 business days',
        marketRate: '153.89',
        rateCurrency: 'JPY',
        perCurrency: 'USDT',
      })),
    });
    const customer = 153.89 * 0.995;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
  });

  it('applies 20 bps below marketRate for USDT → USD', async () => {
    const result = await getOfframpRate('usdt', 'usd', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'usd',
        conversionRate: '0.9988',
        inverseRate: String(1 / 0.9988),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '10',
        maximumAmount: '100000',
        estimatedProcessingTime: '1-3 business days',
        marketRate: '1',
        rateCurrency: 'USD',
        perCurrency: 'USDT',
      })),
    });
    const customer = 1 * 0.998;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
    expect(Number(result.inverseRate)).toBeCloseTo(1 / customer, 10);
  });

  it('applies 20 bps below marketRate for USDT → CAD', async () => {
    const result = await getOfframpRate('usdt', 'cad', 'TRC20', {
      getRateFromPalremit: vi.fn(async () => ({
        fromCurrency: 'usdt',
        toCurrency: 'cad',
        conversionRate: '1.38',
        inverseRate: String(1 / 1.38),
        rateValidUntil: new Date().toISOString(),
        minimumAmount: '10',
        maximumAmount: '100000',
        estimatedProcessingTime: '1-3 business days',
        marketRate: '1.375',
        rateCurrency: 'CAD',
        perCurrency: 'USDT',
      })),
    });
    const customer = 1.375 * 0.998;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
  });

  it('floors USDT → CNY at OwlPay, then takes the saved 20 bps', async () => {
    withSellRow('CNY', 20);
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
    expect(Number(result.conversionRate)).toBeCloseTo(6.2 * 0.998, 10);
    expect(Number(result.inverseRate)).toBeCloseTo(1 / (6.2 * 0.998), 10);
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
