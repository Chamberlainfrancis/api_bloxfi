import { describe, it, expect } from 'vitest';
import type { AccountCapabilities } from '@/types/account';
import {
  findOnrampAccountMarkup,
  resolveOnrampAccountMarkup,
  applyOnrampAccountMarkup,
} from '@/core/quotes/onrampAccountMarkup';

const usdNamed: AccountCapabilities = {
  usdNamedDeposit: { status: 'pending', failureReason: null },
};

describe('findOnrampAccountMarkup', () => {
  it('returns 40 bps for USD when usdNamedDeposit is present', () => {
    const rule = findOnrampAccountMarkup('USD', usdNamed);
    expect(rule).toEqual({
      currency: 'USD',
      capability: 'usdNamedDeposit',
      markup: 0.004,
    });
  });

  it('matches fromCurrency case-insensitively', () => {
    expect(findOnrampAccountMarkup('usd', usdNamed)?.markup).toBe(0.004);
  });

  it('returns null for EUR even when usdNamedDeposit is present', () => {
    expect(findOnrampAccountMarkup('EUR', usdNamed)).toBeNull();
  });

  it('returns null when capabilities are missing', () => {
    expect(findOnrampAccountMarkup('USD', undefined)).toBeNull();
  });
});

describe('resolveOnrampAccountMarkup', () => {
  it('returns null when account.currency does not match fromCurrency', () => {
    expect(
      resolveOnrampAccountMarkup({
        fromCurrency: 'USD',
        account: { currency: 'EUR', railType: 'onramp' },
        capabilities: usdNamed,
      })
    ).toBeNull();
  });

  it('returns null when railType is not onramp', () => {
    expect(
      resolveOnrampAccountMarkup({
        fromCurrency: 'USD',
        account: { currency: 'USD', railType: 'offramp' },
        capabilities: usdNamed,
      })
    ).toBeNull();
  });

  it('returns the USD named rule when currency is empty and accountType is usd', () => {
    expect(
      resolveOnrampAccountMarkup({
        fromCurrency: 'usd',
        account: { currency: '', railType: 'onramp', accountType: 'usd' },
        capabilities: usdNamed,
      })?.markup
    ).toBe(0.004);
  });

  it('returns the USD named rule when currency and rail match', () => {
    expect(
      resolveOnrampAccountMarkup({
        fromCurrency: 'usd',
        account: { currency: 'USD', railType: 'onramp' },
        capabilities: usdNamed,
      })?.markup
    ).toBe(0.004);
  });
});

describe('applyOnrampAccountMarkup', () => {
  it('marks up mid on onramp orientation (to === perCurrency): 100 USD at mid 1 → rate 1.004', () => {
    const priced = applyOnrampAccountMarkup({
      amount: 100,
      toCurrency: 'usdt',
      marketRate: '1',
      rateCurrency: 'USD',
      perCurrency: 'USDT',
      markup: 0.004,
    });
    expect(priced.conversionRate).toBe('1.004');
    expect(priced.conversion).toBeCloseTo(100 / 1.004, 10);
  });

  it('marks up mid on multiply orientation (to === rateCurrency)', () => {
    const priced = applyOnrampAccountMarkup({
      amount: 100,
      toCurrency: 'eur',
      marketRate: '0.87',
      rateCurrency: 'EUR',
      perCurrency: 'USDT',
      markup: 0.004,
    });
    expect(priced.conversion).toBeCloseTo(100 * 0.87 * 1.004, 10);
  });

  it('throws PALREMIT_RATES_UNAVAILABLE when marketRate is missing', () => {
    expect(() =>
      applyOnrampAccountMarkup({
        amount: 100,
        toCurrency: 'usdt',
        marketRate: undefined,
        rateCurrency: 'USD',
        perCurrency: 'USDT',
        markup: 0.004,
      })
    ).toThrow('PALREMIT_RATES_UNAVAILABLE');
  });
});
