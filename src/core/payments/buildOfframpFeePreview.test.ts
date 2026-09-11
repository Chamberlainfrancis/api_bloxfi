import { describe, it, expect } from 'vitest';
import { buildOfframpFeePreview } from '@/core/payments/buildOfframpFeePreview';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

// Funding-asset (USDC) fee — surfaced verbatim, deducted on the send side.
const usdcFee: PalremitWithdrawalFeeQuote = {
  feeUnavailable: false,
  fees: [{ kind: 'Wire fee', amount: '25.00', currency: 'USDC' }],
  totalFee: { amount: '25.00', currency: 'USDC' },
  destinationAmount: null,
  effectiveRate: null,
  expiresAt: null,
};

describe('buildOfframpFeePreview', () => {
  it('deducts the fee (already in send currency) from the SEND side, then converts to receive', () => {
    // Send 100 USDT, gross 400 HKD (rate 4). Fee 25 USDT → net send 75 USDT →
    // receiveNet = 75 × 4 = 300 HKD.
    const p = buildOfframpFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'hkd',
      grossReceive: 400,
      receiveDecimals: 2,
      sendDecimals: 8,
      feeInSendCurrency: 25,
      feeQuote: usdcFee,
    });
    expect(p.sendGross).toEqual({ amount: '100', currency: 'usdt' });
    expect(p.sendNet).toEqual({ amount: '75.00000000', currency: 'usdt' });
    expect(p.receiveGross.amount).toBe('400.00');
    expect(p.receiveNet.amount).toBe('300.00');
    expect(p.transferFee.unavailable).toBe(false);
    // Fee shown verbatim in its own currency (USDC), not converted to HKD.
    expect(p.transferFee.total).toEqual({ amount: '25.00', currency: 'USDC' });
  });

  it('does not deduct when feeInSendCurrency is null (fail-soft) — recipient gets the full amount', () => {
    const p = buildOfframpFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'hkd',
      grossReceive: 400,
      receiveDecimals: 2,
      sendDecimals: 8,
      feeInSendCurrency: null,
      feeQuote: { feeUnavailable: true, fees: [], totalFee: null, destinationAmount: null, effectiveRate: null, expiresAt: null },
    });
    expect(p.sendNet?.amount).toBe('100.00000000');
    expect(p.receiveNet.amount).toBe('400.00');
    expect(p.transferFee.unavailable).toBe(true);
  });

  it('marks unavailable when feeQuote is null', () => {
    const p = buildOfframpFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'hkd',
      grossReceive: 400,
      receiveDecimals: 2,
      sendDecimals: 8,
      feeInSendCurrency: null,
      feeQuote: null,
    });
    expect(p.receiveNet.amount).toBe('400.00');
    expect(p.transferFee.unavailable).toBe(true);
    expect(p.transferFee.total).toBeNull();
  });

  it('treats a zero fee as a known fee (available, no deduction)', () => {
    const p = buildOfframpFeePreview({
      sendAmount: 100,
      sendCurrency: 'usdt',
      receiveCurrency: 'hkd',
      grossReceive: 400,
      receiveDecimals: 2,
      sendDecimals: 8,
      feeInSendCurrency: 0,
      feeQuote: { feeUnavailable: false, fees: [], totalFee: { amount: '0', currency: 'USDC' }, destinationAmount: null, effectiveRate: null, expiresAt: null },
    });
    expect(p.sendNet?.amount).toBe('100.00000000');
    expect(p.receiveNet.amount).toBe('400.00');
    expect(p.transferFee.unavailable).toBe(false);
  });

  it('handles a non-stablecoin send currency proportionally', () => {
    // Send 0.01 BTC, gross 1,000,000 NGN. Fee 0.001 BTC → net 0.009 BTC →
    // receiveNet = gross × 0.009/0.01 = 900,000 NGN.
    const p = buildOfframpFeePreview({
      sendAmount: 0.01,
      sendCurrency: 'btc',
      receiveCurrency: 'ngn',
      grossReceive: 1000000,
      receiveDecimals: 2,
      sendDecimals: 8,
      feeInSendCurrency: 0.001,
      feeQuote: usdcFee,
    });
    expect(p.sendNet?.amount).toBe('0.00900000');
    expect(p.receiveNet.amount).toBe('900000.00');
  });
});
