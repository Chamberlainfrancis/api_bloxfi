import { describe, expect, it } from 'vitest';
import {
  blocksOfframpTransition,
  blocksOnrampTransition,
  offrampFundsReceived,
} from '@/core/ramps/fundsReceivedGuard';

describe('offramp: never fail or expire once the crypto arrived', () => {
  it.each(['CRYPTO_PENDING', 'CRYPTO_CONFIRMED', 'FIAT_INITIATED', 'FIAT_PENDING'])(
    'refuses FAILED / EXPIRED / CRYPTO_FAILED / FIAT_FAILED from %s',
    (status) => {
      for (const next of ['FAILED', 'EXPIRED', 'CRYPTO_FAILED', 'FIAT_FAILED'] as const) {
        expect(blocksOfframpTransition({ status }, next)).toBe(true);
      }
    }
  );

  it('still allows progress, refunds and cancellations', () => {
    for (const next of ['FIAT_PENDING', 'COMPLETED', 'REFUNDED', 'CANCELLED'] as const) {
      expect(blocksOfframpTransition({ status: 'FIAT_PENDING' }, next)).toBe(false);
    }
  });

  it('lets an unfunded offramp expire', () => {
    expect(blocksOfframpTransition({ status: 'AWAITING_CRYPTO' }, 'EXPIRED')).toBe(false);
  });

  it('treats a credited deposit as funded even while status still says awaiting', () => {
    const row = { status: 'AWAITING_CRYPTO', timeline: { lastDepositCreditedAt: '2026-10-14T08:00:00Z' } };
    expect(offrampFundsReceived(row)).toBe(true);
    expect(blocksOfframpTransition(row, 'EXPIRED')).toBe(true);
    expect(offrampFundsReceived({ status: 'AWAITING_CRYPTO', timeline: { cryptoReceivedAmount: 12.5 } })).toBe(true);
    expect(offrampFundsReceived({ status: 'AWAITING_CRYPTO', timeline: { cryptoReceivedAmount: 0 } })).toBe(false);
  });

  it('does nothing for a missing row', () => {
    expect(blocksOfframpTransition(null, 'FAILED')).toBe(false);
  });
});

describe('onramp: never fail or expire once the fiat arrived', () => {
  it.each(['FIAT_PENDING', 'FIAT_PROCESSED', 'CRYPTO_INITIATED', 'CRYPTO_PENDING'])(
    'refuses EXPIRED / FIAT_FAILED / CRYPTO_FAILED from %s',
    (status) => {
      for (const next of ['EXPIRED', 'FIAT_FAILED', 'CRYPTO_FAILED'] as const) {
        expect(blocksOnrampTransition({ status }, next)).toBe(true);
      }
    }
  );

  it('lets an unfunded onramp expire or fail', () => {
    expect(blocksOnrampTransition({ status: 'AWAITING_FUNDS' }, 'EXPIRED')).toBe(false);
    expect(blocksOnrampTransition({ status: 'CREATED' }, 'FIAT_FAILED')).toBe(false);
  });

  it('allows a fiat refund', () => {
    expect(blocksOnrampTransition({ status: 'FIAT_PENDING' }, 'FIAT_RETURNED')).toBe(false);
  });
});
