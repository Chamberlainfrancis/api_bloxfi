import { describe, it, expect } from 'vitest';
import { shouldEmitRampEvent } from '@/core/partnerWebhooks/rampTransition';
import { mapOnrampStatusToEvent, mapOfframpStatusToEvent } from '@/core/partnerWebhooks/events';

const map = mapOnrampStatusToEvent;

describe('shouldEmitRampEvent onramp', () => {
  it('emits created on insert', () => {
    expect(shouldEmitRampEvent(null, 'AWAITING_FUNDS', map)).toBe('onramp.created');
  });
  it('emits fiat_received when leaving awaiting funds', () => {
    expect(shouldEmitRampEvent('AWAITING_FUNDS', 'FIAT_PROCESSED', map)).toBe('onramp.fiat_received');
  });
  it('does not emit inside the fiat pair', () => {
    expect(shouldEmitRampEvent('FIAT_PENDING', 'FIAT_PROCESSED', map)).toBeNull();
  });
  it('does not emit inside the crypto pair', () => {
    expect(shouldEmitRampEvent('CRYPTO_INITIATED', 'CRYPTO_PENDING', map)).toBeNull();
  });
  it('emits expired and completed', () => {
    expect(shouldEmitRampEvent('AWAITING_FUNDS', 'EXPIRED', map)).toBe('onramp.expired');
    expect(shouldEmitRampEvent('CRYPTO_PENDING', 'COMPLETED', map)).toBe('onramp.completed');
  });
});

describe('shouldEmitRampEvent offramp', () => {
  const map = mapOfframpStatusToEvent;

  it('emits created on insert', () => {
    expect(shouldEmitRampEvent(null, 'AWAITING_CRYPTO', map)).toBe('offramp.created');
  });
  it('does not emit inside crypto received pair', () => {
    expect(shouldEmitRampEvent('CRYPTO_PENDING', 'CRYPTO_RECEIVED', map)).toBeNull();
  });
  it('emits confirmed, fiat pair once, cancelled, refunded', () => {
    expect(shouldEmitRampEvent('CRYPTO_RECEIVED', 'CRYPTO_CONFIRMED', map)).toBe('offramp.crypto_confirmed');
    expect(shouldEmitRampEvent('CRYPTO_CONFIRMED', 'FIAT_INITIATED', map)).toBe('offramp.fiat_initiated');
    expect(shouldEmitRampEvent('FIAT_INITIATED', 'FIAT_PENDING', map)).toBeNull();
    expect(shouldEmitRampEvent('AWAITING_CRYPTO', 'CANCELLED', map)).toBe('offramp.cancelled');
    expect(shouldEmitRampEvent('FAILED', 'REFUNDED', map)).toBe('offramp.refunded');
  });
  it('does not emit fee hops', () => {
    expect(shouldEmitRampEvent('CRYPTO_CONFIRMED', 'PROCESSING_FEE', map)).toBeNull();
    expect(shouldEmitRampEvent('PROCESSING_FEE', 'FEE_PROCESSED', map)).toBeNull();
  });
});
