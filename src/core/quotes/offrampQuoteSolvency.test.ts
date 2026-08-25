import { describe, expect, it } from 'vitest';
import { offrampImpliedSourceExceedsSendNet } from '@/core/quotes/offrampQuoteSolvency';

describe('offrampImpliedSourceExceedsSendNet', () => {
  it('is insolvent when implied USDC exceeds sendNet', () => {
    expect(
      offrampImpliedSourceExceedsSendNet({
        sendNet: 32138.11,
        receiveNet: 27899.65,
        effectiveRate: 0.855861,
      }),
    ).toBe(true);
  });

  it('is solvent at break-even', () => {
    expect(
      offrampImpliedSourceExceedsSendNet({
        sendNet: 100,
        receiveNet: 85.5861,
        effectiveRate: 0.855861,
      }),
    ).toBe(false);
  });

  it('skips when effectiveRate is missing', () => {
    expect(
      offrampImpliedSourceExceedsSendNet({
        sendNet: 100,
        receiveNet: 200,
        effectiveRate: null,
      }),
    ).toBe(false);
  });
});
