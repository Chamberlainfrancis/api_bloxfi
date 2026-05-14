import { describe, it, expect } from 'vitest';
import { maskPublicOfframpDestination } from '@/core/offramps/maskOfframpDestination';
import type { OfframpDestination } from '@/types/offramp';

describe('maskPublicOfframpDestination', () => {
  it('masks accountNumber and bankCode in metadata when present', () => {
    const dest: OfframpDestination = {
      userId: 'u',
      currency: 'usd',
      amount: 100,
      purposeOfPayment: 'p',
      metadata: {
        accountNumber: '000123456789',
        bankCode: '021000021',
        extras: { isSelfTransfer: false },
      },
    };
    const m = maskPublicOfframpDestination(dest);
    expect(m.metadata?.accountNumber).toBe('****6789');
    expect(m.metadata?.bankCode).toBe('****0021');
    expect(m.metadata?.extras).toEqual({
      isSelfTransfer: false,
    });
  });

  it('returns destination unchanged when metadata absent', () => {
    const dest: OfframpDestination = {
      userId: 'u',
      currency: 'ngn',
      amount: 100,
      purposeOfPayment: 'p',
    };
    expect(maskPublicOfframpDestination(dest)).toBe(dest);
  });
});
