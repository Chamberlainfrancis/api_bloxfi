import { describe, expect, it } from 'vitest';
import { resolveOfframpQuoteCorridor } from '@/core/quotes/resolveOfframpQuoteCorridor';

const deAccount = {
  asset: 'EUR',
  country: 'DE',
  destinationType: 'local_bank',
  beneficiaryType: 'business' as const,
};

describe('resolveOfframpQuoteCorridor', () => {
  it('uses the body corridor when there is no account', () => {
    expect(
      resolveOfframpQuoteCorridor({
        toCurrency: 'eur',
        body: { country: 'fr', destinationType: 'local_bank' },
        account: null,
      })
    ).toEqual({ country: 'FR', destinationType: 'local_bank' });
  });

  it('fills country and rail from the payout account when the body omits them', () => {
    expect(
      resolveOfframpQuoteCorridor({
        toCurrency: 'eur',
        body: {},
        account: deAccount,
      })
    ).toEqual({
      country: 'DE',
      destinationType: 'local_bank',
      beneficiaryType: 'business',
    });
  });

  it('rejects when the quoted asset does not match the account corridor', () => {
    expect(() =>
      resolveOfframpQuoteCorridor({
        toCurrency: 'ngn',
        body: {},
        account: deAccount,
      })
    ).toThrow('QUOTE_CORRIDOR_MISMATCH');
  });

  it('rejects when the body country disagrees with the account', () => {
    expect(() =>
      resolveOfframpQuoteCorridor({
        toCurrency: 'eur',
        body: { country: 'FR', destinationType: 'local_bank' },
        account: deAccount,
      })
    ).toThrow('QUOTE_CORRIDOR_MISMATCH');
  });

  it('requires country and destinationType when there is no account', () => {
    expect(() =>
      resolveOfframpQuoteCorridor({
        toCurrency: 'eur',
        body: {},
        account: null,
      })
    ).toThrow('CORRIDOR_REQUIRED');
  });
});
