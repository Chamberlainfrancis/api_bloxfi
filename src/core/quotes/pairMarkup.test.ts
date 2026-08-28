import { describe, it, expect } from 'vitest';
import { applyOnrampAccountMarkup } from '@/core/quotes/onrampAccountMarkup';
import { findPairMarkup, applyPairMarkup } from '@/core/quotes/pairMarkup';

describe('findPairMarkup', () => {
  it('returns 2.4% buy for EUR onramp (EUR → USDT)', () => {
    expect(findPairMarkup('eur', 'usdt')).toEqual({
      fiat: 'EUR',
      markup: 0.024,
      side: 'buy',
    });
  });

  it('returns 2.4% buy for EUR → USD and EUR → USDC', () => {
    expect(findPairMarkup('EUR', 'USD')?.markup).toBe(0.024);
    expect(findPairMarkup('eur', 'usdc')?.side).toBe('buy');
  });

  it('returns 25 bps sell for USD/USDT/USDC → EUR offramp', () => {
    expect(findPairMarkup('usdt', 'eur')).toEqual({
      fiat: 'EUR',
      markup: 0.0025,
      side: 'sell',
    });
    expect(findPairMarkup('USD', 'EUR')?.side).toBe('sell');
    expect(findPairMarkup('usdc', 'eur')?.markup).toBe(0.0025);
  });

  it('returns null for corridors that are not USD↔EUR', () => {
    expect(findPairMarkup('usd', 'usdt')).toBeNull();
    expect(findPairMarkup('ngn', 'usdt')).toBeNull();
    expect(findPairMarkup('usdt', 'ngn')).toBeNull();
    expect(findPairMarkup('eur', 'ngn')).toBeNull();
  });
});

describe('applyPairMarkup', () => {
  it('onramp buy: customerRate = marketRate × (1 + 2.4%), less USDT out', () => {
    const priced = applyPairMarkup({
      amount: 100,
      toCurrency: 'usdt',
      marketRate: '0.87',
      rateCurrency: 'EUR',
      perCurrency: 'USDT',
      markup: 0.024,
      side: 'buy',
    });
    expect(Number(priced.conversionRate)).toBeCloseTo(0.87 * 1.024, 10);
    expect(priced.conversion).toBeCloseTo(100 / (0.87 * 1.024), 10);
  });

  it('offramp sell: customerRate = marketRate × (1 − 25bps), less EUR out', () => {
    const priced = applyPairMarkup({
      amount: 1000,
      toCurrency: 'eur',
      marketRate: '0.87',
      rateCurrency: 'EUR',
      perCurrency: 'USDT',
      markup: 0.0025,
      side: 'sell',
    });
    expect(Number(priced.conversionRate)).toBeCloseTo(0.87 * 0.9975, 10);
    expect(priced.conversion).toBeCloseTo(1000 * 0.87 * 0.9975, 10);
  });

  it('buy path matches applyOnrampAccountMarkup', () => {
    const args = {
      amount: 100,
      toCurrency: 'usdt',
      marketRate: '0.87' as const,
      rateCurrency: 'EUR',
      perCurrency: 'USDT',
      markup: 0.024,
    };
    expect(applyPairMarkup({ ...args, side: 'buy' })).toEqual(applyOnrampAccountMarkup(args));
  });
});
