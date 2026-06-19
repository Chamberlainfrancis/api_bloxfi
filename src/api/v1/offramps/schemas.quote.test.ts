import { describe, it, expect } from 'vitest';
import { createOfframpBodySchema } from '@/api/v1/offramps/schemas';

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
