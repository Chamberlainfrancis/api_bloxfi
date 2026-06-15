import { describe, it, expect } from 'vitest';
import { buildRampFeePreview } from '@/core/payments/buildRampFeePreview';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

const fiatFee: PalremitWithdrawalFeeQuote = {
  feeUnavailable: false,
  fees: [{ kind: 'network_fee', amount: '2250.00', currency: 'NGN' }],
  totalFee: { amount: '2250.00', currency: 'NGN' },
  destinationAmount: null,
  effectiveRate: null,
  expiresAt: null,
};

describe('buildRampFeePreview', () => {
  it('offramp: deducts the fiat fee from gross receive', () => {
    // 100 USDT × 1500 = 150,000 NGN gross; − 2,250 fee → 147,750 net.
    const p = buildRampFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'ngn',
      rate: 1500,
      receiveDecimals: 2,
      feeQuote: fiatFee,
    });
    expect(p.receiveGross.amount).toBe('150000.00');
    expect(p.receiveNet.amount).toBe('147750.00');
    expect(p.providerFee.unavailable).toBe(false);
    expect(p.providerFee.total).toEqual({ amount: '2250.00', currency: 'NGN' });
  });

  it('marks unavailable and does not deduct when fee is unavailable', () => {
    const p = buildRampFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'ngn',
      rate: 1500,
      receiveDecimals: 2,
      feeQuote: { feeUnavailable: true, fees: [], totalFee: null, destinationAmount: null, effectiveRate: null, expiresAt: null },
    });
    expect(p.receiveNet.amount).toBe('150000.00');
    expect(p.providerFee.unavailable).toBe(true);
  });

  it('marks unavailable when feeQuote is null', () => {
    const p = buildRampFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'ngn',
      rate: 1500,
      receiveDecimals: 2,
      feeQuote: null,
    });
    expect(p.receiveNet.amount).toBe('150000.00');
    expect(p.providerFee.unavailable).toBe(true);
  });

  it('ignores a mismatched-currency fee (no wrong deduction)', () => {
    const p = buildRampFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'ngn',
      rate: 1500,
      receiveDecimals: 2,
      feeQuote: { feeUnavailable: false, fees: [], totalFee: { amount: '5', currency: 'USD' }, destinationAmount: null, effectiveRate: null, expiresAt: null },
    });
    expect(p.receiveNet.amount).toBe('150000.00');
    expect(p.providerFee.unavailable).toBe(true);
  });

  it('onramp: formats crypto receive to 8 decimals', () => {
    const p = buildRampFeePreview({
      sendAmount: 100,
      sendCurrency: 'usd',
      receiveCurrency: 'usdt',
      rate: 1,
      receiveDecimals: 8,
      feeQuote: { feeUnavailable: false, fees: [{ kind: 'network_fee', amount: '2', currency: 'USDT' }], totalFee: { amount: '2', currency: 'USDT' }, destinationAmount: null, effectiveRate: null, expiresAt: null },
    });
    expect(p.receiveGross.amount).toBe('100.00000000');
    expect(p.receiveNet.amount).toBe('98.00000000');
  });
});
