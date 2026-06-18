import { describe, it, expect } from 'vitest';
import { resolveOnrampFees } from '@/core/onramps/resolveOnrampFees';

describe('resolveOnrampFees', () => {
  it('returns fees JSON when present', () => {
    const fees = {
      platformFee: {
        type: 'PERCENTAGE' as const,
        value: '0.01',
        amount: '1.00000000',
        currency: 'usdt',
        walletAddress: '0xFee',
      },
    };
    expect(resolveOnrampFees({ fees, developerFee: null })).toEqual(fees);
  });

  it('falls back to legacy developerFee', () => {
    expect(
      resolveOnrampFees({
        fees: null,
        developerFee: { amount: '0.5', currency: 'usdt' },
      })
    ).toEqual({
      platformFee: {
        type: 'FLAT',
        value: '0.5',
        amount: '0.5',
        currency: 'usdt',
        walletAddress: '',
      },
    });
  });
});
