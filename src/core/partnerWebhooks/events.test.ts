import { describe, it, expect } from 'vitest';
import { mapOnrampStatusToEvent, mapOfframpStatusToEvent } from '@/core/partnerWebhooks/events';

describe('mapOnrampStatusToEvent', () => {
  it('maps create and awaiting funds to onramp.created', () => {
    expect(mapOnrampStatusToEvent('CREATED')).toBe('onramp.created');
    expect(mapOnrampStatusToEvent('AWAITING_FUNDS')).toBe('onramp.created');
  });
  it('collapses fiat pending/processed to onramp.fiat_received', () => {
    expect(mapOnrampStatusToEvent('FIAT_PENDING')).toBe('onramp.fiat_received');
    expect(mapOnrampStatusToEvent('FIAT_PROCESSED')).toBe('onramp.fiat_received');
  });
  it('collapses crypto initiated/pending to onramp.crypto_initiated', () => {
    expect(mapOnrampStatusToEvent('CRYPTO_INITIATED')).toBe('onramp.crypto_initiated');
    expect(mapOnrampStatusToEvent('CRYPTO_PENDING')).toBe('onramp.crypto_initiated');
  });
  it('maps terminals', () => {
    expect(mapOnrampStatusToEvent('COMPLETED')).toBe('onramp.completed');
    expect(mapOnrampStatusToEvent('FIAT_FAILED')).toBe('onramp.failed');
    expect(mapOnrampStatusToEvent('FIAT_RETURNED')).toBe('onramp.failed');
    expect(mapOnrampStatusToEvent('CRYPTO_FAILED')).toBe('onramp.failed');
    expect(mapOnrampStatusToEvent('EXPIRED')).toBe('onramp.expired');
  });
});

describe('mapOfframpStatusToEvent', () => {
  it('maps create and awaiting crypto to offramp.created', () => {
    expect(mapOfframpStatusToEvent('CREATED')).toBe('offramp.created');
    expect(mapOfframpStatusToEvent('AWAITING_CRYPTO')).toBe('offramp.created');
  });
  it('collapses crypto pending/received', () => {
    expect(mapOfframpStatusToEvent('CRYPTO_PENDING')).toBe('offramp.crypto_received');
    expect(mapOfframpStatusToEvent('CRYPTO_RECEIVED')).toBe('offramp.crypto_received');
  });
  it('maps confirmed, fiat pair, and terminals', () => {
    expect(mapOfframpStatusToEvent('CRYPTO_CONFIRMED')).toBe('offramp.crypto_confirmed');
    expect(mapOfframpStatusToEvent('FIAT_INITIATED')).toBe('offramp.fiat_initiated');
    expect(mapOfframpStatusToEvent('FIAT_PENDING')).toBe('offramp.fiat_initiated');
    expect(mapOfframpStatusToEvent('COMPLETED')).toBe('offramp.completed');
    expect(mapOfframpStatusToEvent('FAILED')).toBe('offramp.failed');
    expect(mapOfframpStatusToEvent('CRYPTO_FAILED')).toBe('offramp.failed');
    expect(mapOfframpStatusToEvent('FIAT_FAILED')).toBe('offramp.failed');
    expect(mapOfframpStatusToEvent('CANCELLED')).toBe('offramp.cancelled');
    expect(mapOfframpStatusToEvent('REFUNDED')).toBe('offramp.refunded');
    expect(mapOfframpStatusToEvent('EXPIRED')).toBe('offramp.expired');
  });
  it('does not emit fee-processing hops', () => {
    expect(mapOfframpStatusToEvent('PROCESSING_FEE')).toBeNull();
    expect(mapOfframpStatusToEvent('FEE_PROCESSED')).toBeNull();
  });
});
