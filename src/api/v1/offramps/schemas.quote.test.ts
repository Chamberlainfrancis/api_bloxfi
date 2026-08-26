import { describe, it, expect } from 'vitest';
import { createOfframpBodySchema, createOfframpQuoteBodySchema } from '@/api/v1/offramps/schemas';

describe('createOfframpQuoteBodySchema platformFee.network', () => {
  const accountId = '55555555-5555-4555-8555-555555555555';
  const base = {
    fromCurrency: 'usdt',
    toCurrency: 'eur',
    fromChain: 'TRC20',
    amount: 1000,
    accountId,
    platformFee: {
      type: 'PERCENTAGE' as const,
      value: 0.01,
      walletAddress: '0xFee',
      currency: 'USDC',
      network: 'MATIC',
    },
  };

  it('accepts a quote when platformFee.network is provided', () => {
    expect(createOfframpQuoteBodySchema.safeParse(base).success).toBe(true);
  });

  it('rejects a quote when platformFee.network is missing (required for USDC settlement)', () => {
    const { network, ...feeWithoutNetwork } = base.platformFee;
    const r = createOfframpQuoteBodySchema.safeParse({ ...base, platformFee: feeWithoutNetwork });
    expect(r.success).toBe(false);
  });

  it('accepts accountId without country and destinationType', () => {
    const r = createOfframpQuoteBodySchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.accountId).toBe(accountId);
      expect(r.data.corridor).toEqual({});
    }
  });

  it('rejects a quote without accountId even when country and destinationType are sent', () => {
    const r = createOfframpQuoteBodySchema.safeParse({
      fromCurrency: 'usdt',
      toCurrency: 'eur',
      fromChain: 'TRC20',
      amount: 1000,
      country: 'DE',
      destinationType: 'local_bank',
      platformFee: base.platformFee,
    });
    expect(r.success).toBe(false);
  });
});

describe('createOfframpBodySchema quoteId', () => {
  it('accepts execution-only body when quoteId is provided', () => {
    const r = createOfframpBodySchema.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111',
      quoteId: '22222222-2222-4222-8222-222222222222',
      source: {
        userId: '33333333-3333-4333-8333-333333333333',
        externalWalletId: '44444444-4444-4444-8444-444444444444',
      },
      destination: {
        userId: '33333333-3333-4333-8333-333333333333',
        accountId: '55555555-5555-4555-8555-555555555555',
        purposeOfPayment: 'trade',
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects pricing fields when quoteId is provided', () => {
    const r = createOfframpBodySchema.safeParse({
      requestId: '11111111-1111-4111-8111-111111111111',
      quoteId: '22222222-2222-4222-8222-222222222222',
      source: {
        userId: '33333333-3333-4333-8333-333333333333',
        externalWalletId: '44444444-4444-4444-8444-444444444444',
        amount: 100,
      },
      destination: {
        userId: '33333333-3333-4333-8333-333333333333',
        accountId: '55555555-5555-4555-8555-555555555555',
        purposeOfPayment: 'trade',
      },
      platformFee: {
        type: 'PERCENTAGE',
        value: 0,
        walletAddress: '0x1',
      },
    });
    expect(r.success).toBe(false);
  });
});
