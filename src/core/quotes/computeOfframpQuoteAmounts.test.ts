import { describe, it, expect } from 'vitest';
import { computeOfframpQuoteAmounts } from '@/core/quotes/computeOfframpQuoteAmounts';
import type { PlatformFee } from '@/types/offramp';

const platformFeeOnePct: PlatformFee = {
  type: 'PERCENTAGE',
  value: 0.01,
  walletAddress: '0xFee',
};

describe('computeOfframpQuoteAmounts', () => {
  it('takes the platform fee from the source crypto (gross), before the transfer fee', () => {
    const amounts = computeOfframpQuoteAmounts({
      sendAmount: 1000,
      baseConversionRate: 0.9984,
      feeInSendCurrency: 19.6068404,
      platformFee: platformFeeOnePct,
    });
    // platform fee = 1% of 1000 = 10 (USDT, source crypto)
    expect(amounts.platformFeeAmount).toBeCloseTo(10, 8);
    // sendNet = 1000 - 10 - 19.6068404 = 970.3931596 (source crypto)
    expect(amounts.sendNet).toBeCloseTo(970.3931596, 6);
    // receiveNet = sendNet * 0.9984
    expect(amounts.receiveNet).toBeCloseTo(968.8405305446399, 8);
    // baseReceiveNet = (1000 - 19.6068404) * 0.9984 (no platform fee)
    expect(amounts.baseReceiveNet).toBeCloseTo(978.82453054464, 8);
    expect(amounts.allInConversionRate).toBeCloseTo(0.9688405305446399, 8);
  });

  it('treats a null transfer fee as zero (fail-soft) and still deducts the platform fee', () => {
    const amounts = computeOfframpQuoteAmounts({
      sendAmount: 100,
      baseConversionRate: 1500,
      feeInSendCurrency: null,
      platformFee: platformFeeOnePct,
    });
    expect(amounts.platformFeeAmount).toBeCloseTo(1, 8); // 1% of 100
    expect(amounts.sendNet).toBeCloseTo(99, 8);
    expect(amounts.receiveNet).toBeCloseTo(148500, 2);
  });
});
