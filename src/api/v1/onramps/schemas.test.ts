import { describe, it, expect } from 'vitest';
import { createOnrampBodySchema, createOnrampQuoteBodySchema } from '@/api/v1/onramps/schemas';

const baseBody = {
  requestId: '11111111-1111-4111-8111-111111111111',
  source: {
    amount: 100,
    currency: 'USD',
    userId: '22222222-2222-4222-8222-222222222222',
    transferType: 'ach',
  },
  destination: {
    currency: 'USDT',
    chain: 'POLYGON',
    userId: '22222222-2222-4222-8222-222222222222',
    externalWalletId: '33333333-3333-4333-8333-333333333333',
  },
  platformFee: {
    type: 'PERCENTAGE' as const,
    value: 0.01,
    walletAddress: '0x0000000000000000000000000000000000000001',
  },
};

describe('createOnrampBodySchema', () => {
  it('accepts optional source.accountId as a UUID (Prisma Account.id)', () => {
    const accountId = '44444444-4444-4444-8444-444444444444';
    const r = createOnrampBodySchema.safeParse({
      ...baseBody,
      source: { ...baseBody.source, accountId },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.source.accountId).toBe(accountId);
    }
  });

  it('rejects non-uuid source.accountId', () => {
    const r = createOnrampBodySchema.safeParse({
      ...baseBody,
      source: { ...baseBody.source, accountId: 'prov-not-an-account-id' },
    });
    expect(r.success).toBe(false);
  });

  it('accepts platformFee without currency or network', () => {
    const r = createOnrampBodySchema.safeParse(baseBody);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.platformFee.walletAddress).toBe(baseBody.platformFee.walletAddress);
      expect(r.data.platformFee.currency).toBeUndefined();
      expect(r.data.platformFee.network).toBeUndefined();
    }
  });

  it('accepts optional accountId on an onramp quote', () => {
    const accountId = '44444444-4444-4444-8444-444444444444';
    const r = createOnrampQuoteBodySchema.safeParse({
      fromCurrency: 'USD',
      toCurrency: 'USDT',
      amount: 100,
      chain: 'POLYGON',
      accountId,
      platformFee: baseBody.platformFee,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.accountId).toBe(accountId);
    }
  });

  it('omits accountId on an onramp quote when not sent', () => {
    const r = createOnrampQuoteBodySchema.safeParse({
      fromCurrency: 'USD',
      toCurrency: 'USDT',
      amount: 100,
      chain: 'POLYGON',
      platformFee: baseBody.platformFee,
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.accountId).toBeUndefined();
    }
  });

  it('rejects non-uuid accountId on an onramp quote', () => {
    const r = createOnrampQuoteBodySchema.safeParse({
      fromCurrency: 'USD',
      toCurrency: 'USDT',
      amount: 100,
      chain: 'POLYGON',
      accountId: 'not-a-uuid',
      platformFee: baseBody.platformFee,
    });
    expect(r.success).toBe(false);
  });

  it('accepts optional platformFee.currency and platformFee.network', () => {
    const r = createOnrampBodySchema.safeParse({
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
