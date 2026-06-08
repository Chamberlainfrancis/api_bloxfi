import { describe, it, expect } from 'vitest';
import {
  expectedOfframpCryptoAmount,
  isOfframpCryptoDepositComplete,
  parseDepositWebhookAmount,
  priorCryptoReceivedAmount,
} from '@/core/offramps/offrampDepositAmount';

describe('offrampDepositAmount', () => {
  it('parses deposit amount from webhook payload', () => {
    expect(parseDepositWebhookAmount({ amount: 100 })).toBe(100);
    expect(parseDepositWebhookAmount({ amount: '250.5' })).toBe(250.5);
    expect(parseDepositWebhookAmount({})).toBeNull();
  });

  it('reads expected amount from source then depositInstructions', () => {
    expect(
      expectedOfframpCryptoAmount({
        source: { amount: 600250 },
        depositInstructions: { amount: '100' },
      })
    ).toBe(600250);
    expect(
      expectedOfframpCryptoAmount({
        source: {},
        depositInstructions: { amount: '100' },
      })
    ).toBe(100);
  });

  it('accumulates prior received from timeline', () => {
    expect(priorCryptoReceivedAmount({ cryptoReceivedAmount: 100 })).toBe(100);
    expect(priorCryptoReceivedAmount({})).toBe(0);
  });

  it('requires full quoted amount before payout', () => {
    expect(isOfframpCryptoDepositComplete(100, 600250)).toBe(false);
    expect(isOfframpCryptoDepositComplete(600249.999999, 600250)).toBe(true);
    expect(isOfframpCryptoDepositComplete(600250, 600250)).toBe(true);
    expect(isOfframpCryptoDepositComplete(700000, 600250)).toBe(true);
  });
});
