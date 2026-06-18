import { describe, it, expect } from 'vitest';
import { createOfframpBodySchema } from '@/api/v1/offramps/schemas';

const baseBody = {
  requestId: '11111111-1111-4111-8111-111111111111',
  source: {
    amount: 100,
    currency: 'usdt',
    chain: 'TRC20',
    userId: '22222222-2222-4222-8222-222222222222',
    externalWalletId: '33333333-3333-4333-8333-333333333333',
  },
  destination: {
    currency: 'NGN',
    userId: '22222222-2222-4222-8222-222222222222',
    accountId: '44444444-4444-4444-8444-444444444444',
    purposeOfPayment: 'trade',
  },
  platformFee: {
    type: 'PERCENTAGE' as const,
    value: 0,
    walletAddress: '0x0000000000000000000000000000000000000001',
  },
};

describe('createOfframpBodySchema', () => {
  it('accepts NGN without metadata', () => {
    const r = createOfframpBodySchema.safeParse(baseBody);
    expect(r.success).toBe(true);
  });

  it('accepts USD with destination.purposeOfPayment UPPER_SNAKE and metadata.isSelfTransfer', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      destination: {
        ...baseBody.destination,
        currency: 'USD',
        purposeOfPayment: 'FAMILY_MAINTENANCE',
      },
      metadata: {
        isSelfTransfer: false,
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects USD without metadata', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      destination: {
        ...baseBody.destination,
        currency: 'USD',
        purposeOfPayment: 'FAMILY_MAINTENANCE',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects USD when purposeOfPayment is not UPPER_SNAKE', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      destination: {
        ...baseBody.destination,
        currency: 'USD',
        purposeOfPayment: 'Cross-border settlement',
      },
      metadata: { isSelfTransfer: false },
    });
    expect(r.success).toBe(false);
  });

  it('accepts USD metadata extras without root transferPurpose (purpose is on destination)', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      destination: {
        ...baseBody.destination,
        currency: 'USD',
        purposeOfPayment: 'FAMILY_MAINTENANCE',
      },
      metadata: {
        isSelfTransfer: false,
        extras: { isSelfTransfer: true },
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts optional metadata for NGN', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      metadata: { note: 'internal ref 123' },
    });
    expect(r.success).toBe(true);
  });

  it('accepts platformFee without currency or network (backward compatible)', () => {
    const r = createOfframpBodySchema.safeParse(baseBody);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.platformFee.walletAddress).toBe(baseBody.platformFee.walletAddress);
      expect(r.data.platformFee.currency).toBeUndefined();
      expect(r.data.platformFee.network).toBeUndefined();
    }
  });

  it('accepts optional platformFee.currency and platformFee.network', () => {
    const r = createOfframpBodySchema.safeParse({
      ...baseBody,
      platformFee: {
        ...baseBody.platformFee,
        currency: 'USDC',
        network: 'MATIC',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.platformFee.currency).toBe('USDC');
      expect(r.data.platformFee.network).toBe('MATIC');
    }
  });
});
