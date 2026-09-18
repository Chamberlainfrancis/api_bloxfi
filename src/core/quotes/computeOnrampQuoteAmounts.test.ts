import { describe, it, expect } from 'vitest';
import { applyOfframpPlatformFee } from '@/core/payments/applyOfframpPlatformFee';
import { solveOnrampSendFromDest } from '@/core/quotes/computeOnrampQuoteAmounts';
import type { PlatformFee } from '@/types/offramp';

const noFee: PlatformFee = { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' };
const onePct: PlatformFee = { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' };

describe('solveOnrampSendFromDest', () => {
  it('back-solves fiat send so crypto receiveNet equals dest (fiat-per-crypto)', () => {
    const solved = solveOnrampSendFromDest({
      destinationAmount: 100,
      conversionRate: 1,
      transferFeeCrypto: 0,
      platformFee: noFee,
      toCurrency: 'usdt',
      rateCurrency: 'USD',
      perCurrency: 'USDT',
    });
    expect(solved.receiveNet).toBe(100);
    expect(solved.sendGross).toBe(100);
    expect(solved.receiveGross).toBe(100);
  });

  it('uses customerRate as fiat-per-crypto: dest 100 at 1.004 → send 100.4', () => {
    const solved = solveOnrampSendFromDest({
      destinationAmount: 100,
      conversionRate: 1.004,
      transferFeeCrypto: 0,
      platformFee: noFee,
      toCurrency: 'usdt',
      rateCurrency: 'USD',
      perCurrency: 'USDT',
    });
    expect(solved.sendGross).toBeCloseTo(100 * 1.004, 8);
    expect(solved.receiveNet).toBe(100);
  });

  it('adds percentage platform fee and transfer fee on top of dest', () => {
    const dest = 100;
    const rate = 1;
    const transferFee = 2;
    const solved = solveOnrampSendFromDest({
      destinationAmount: dest,
      conversionRate: rate,
      transferFeeCrypto: transferFee,
      platformFee: onePct,
      toCurrency: 'usdt',
      rateCurrency: 'USD',
      perCurrency: 'USDT',
    });
    const applied = applyOfframpPlatformFee(solved.receiveGross, onePct);
    expect(applied.netAmount - transferFee).toBeCloseTo(dest, 8);
    expect(solved.receiveNet).toBe(dest);
    expect(solved.sendGross).toBeGreaterThan(dest);
  });

  it('inverts multiply orientation (to === rateCurrency)', () => {
    const solved = solveOnrampSendFromDest({
      destinationAmount: 87,
      conversionRate: 0.87,
      transferFeeCrypto: 0,
      platformFee: noFee,
      toCurrency: 'eur',
      rateCurrency: 'EUR',
      perCurrency: 'USDT',
    });
    expect(solved.sendGross).toBeCloseTo(87 / 0.87, 8);
    expect(solved.receiveNet).toBe(87);
  });
});
