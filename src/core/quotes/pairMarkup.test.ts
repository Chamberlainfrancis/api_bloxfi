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

  it('returns 0.5% sell for USD/USDT/USDC → EUR offramp', () => {
    expect(findPairMarkup('usdt', 'eur')).toEqual({
      fiat: 'EUR',
      markup: 0.005,
      side: 'sell',
    });
    expect(findPairMarkup('USD', 'EUR')?.side).toBe('sell');
    expect(findPairMarkup('usdc', 'eur')?.markup).toBe(0.005);
  });

  it('returns 0.5% buy and sell for CAD ↔ USD/USDT/USDC', () => {
    expect(findPairMarkup('cad', 'usdt')).toEqual({
      fiat: 'CAD',
      markup: 0.005,
      side: 'buy',
    });
    expect(findPairMarkup('USDT', 'CAD')).toEqual({
      fiat: 'CAD',
      markup: 0.005,
      side: 'sell',
    });
    expect(findPairMarkup('CAD', 'USD')?.markup).toBe(0.005);
    expect(findPairMarkup('usdc', 'cad')?.side).toBe('sell');
  });

  it('returns null for corridors that are not USD↔EUR or USD↔CAD', () => {
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

  it('offramp sell: customerRate = marketRate × (1 − 0.5%), less EUR out', () => {
    const priced = applyPairMarkup({
      amount: 1000,
      toCurrency: 'eur',
      marketRate: '0.87',
      rateCurrency: 'EUR',
      perCurrency: 'USDT',
      markup: 0.005,
      side: 'sell',
    });
    expect(Number(priced.conversionRate)).toBeCloseTo(0.87 * 0.995, 10);
    expect(priced.conversion).toBeCloseTo(1000 * 0.87 * 0.995, 10);
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
