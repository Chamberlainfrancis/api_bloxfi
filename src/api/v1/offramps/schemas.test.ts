import { describe, it, expect } from 'vitest';
import { createOfframpBodySchema } from '@/api/v1/offramps/schemas';

// quote-first base: no source.amount/currency/chain, no destination.currency, no platformFee
const baseBody = {
  requestId: '11111111-1111-4111-8111-111111111111',
  quoteId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source: {
    userId: '22222222-2222-4222-8222-222222222222',
    externalWalletId: '33333333-3333-4333-8333-333333333333',
  },
  destination: {
    userId: '22222222-2222-4222-8222-222222222222',
    accountId: '44444444-4444-4444-8444-444444444444',
    purposeOfPayment: 'trade',
  },
};

describe('createOfframpBodySchema', () => {
  it('accepts quote-first create without metadata', () => {
    const r = createOfframpBodySchema.safeParse(baseBody);
    expect(r.success).toBe(true);
  });

  it('accepts quote-first create with optional metadata', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      metadata: { note: 'internal ref 123' },
    });
    expect(r.success).toBe(true);
  });

  it('rejects when destination.currency is supplied (fixed by quote)', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      destination: {
        ...baseBody.destination,
        currency: 'NGN',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects when source.amount is supplied (fixed by quote)', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      source: {
        ...baseBody.source,
        amount: 100,
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects when source.currency is supplied (fixed by quote)', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      source: {
        ...baseBody.source,
        currency: 'usdt',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects when source.chain is supplied (fixed by quote)', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      source: {
        ...baseBody.source,
        chain: 'TRC20',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects when platformFee is supplied (fixed by quote)', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      platformFee: {
        type: 'PERCENTAGE' as const,
        value: 0,
        walletAddress: '0x0000000000000000000000000000000000000001',
      },
    });
    expect(r.success).toBe(false);
  });
});

describe('createOfframpBodySchema — quote-first only', () => {
  const base = {
    requestId: '11111111-1111-1111-1111-111111111111',
    source: {
      userId: '22222222-2222-2222-2222-222222222222',
      externalWalletId: '33333333-3333-3333-3333-333333333333',
    },
    destination: {
      userId: '22222222-2222-2222-2222-222222222222',
      accountId: '44444444-4444-4444-4444-444444444444',
      purposeOfPayment: 'family_support',
    },
  };

  it('rejects a create without quoteId', () => {
    const r = createOfframpBodySchema.safeParse(base);
    expect(r.success).toBe(false);
  });

  it('accepts a create with quoteId and identity fields', () => {
    const r = createOfframpBodySchema.safeParse({
      ...base,
      quoteId: '55555555-5555-5555-5555-555555555555',
    });
    expect(r.success).toBe(true);
  });

  it('rejects platformFee when quoteId is present', () => {
    const r = createOfframpBodySchema.safeParse({
      ...base,
      quoteId: '55555555-5555-5555-5555-555555555555',
      platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' },
    });
    expect(r.success).toBe(false);
  });
});
