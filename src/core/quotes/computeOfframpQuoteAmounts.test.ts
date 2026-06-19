import { describe, it, expect } from 'vitest';
import { computeOfframpQuoteAmounts } from '@/core/quotes/computeOfframpQuoteAmounts';
import type { PlatformFee } from '@/types/offramp';

const platformFeeOnePct: PlatformFee = {
  type: 'PERCENTAGE',
  value: 0.01,
  walletAddress: '0xFee',
};

describe('computeOfframpQuoteAmounts', () => {
  it('applies transfer fee on send then platform fee on fiat receive', () => {
    const amounts = computeOfframpQuoteAmounts({
      sendAmount: 1000,
      baseConversionRate: 0.9984,
      feeInSendCurrency: 19.6068404,
      platformFee: platformFeeOnePct,
    });
    expect(amounts.receiveNet).toBeCloseTo(969.03628624, 4);
    expect(amounts.allInConversionRate).toBeCloseTo(0.96903628624, 8);
  });
});
