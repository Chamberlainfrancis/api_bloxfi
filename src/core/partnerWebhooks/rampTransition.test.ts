import { describe, it, expect } from 'vitest';
import { shouldEmitRampEvent } from '@/core/partnerWebhooks/rampTransition';
import { mapOnrampStatusToEvent } from '@/core/partnerWebhooks/events';

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
