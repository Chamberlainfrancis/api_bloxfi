import { describe, it, expect, vi } from 'vitest';
import { resolveTransferFeeInSendCurrency } from '@/core/payments/resolveTransferFeeInSendCurrency';
import type { GetOfframpRatesResponse } from '@/types/offramp';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

function rate(conversionRate: string): GetOfframpRatesResponse {
  return { conversionRate } as unknown as GetOfframpRatesResponse;
}

function quote(total: { amount: string; currency: string } | null, feeUnavailable = false): PalremitWithdrawalFeeQuote {
  return {
    feeUnavailable,
    fees: total ? [{ kind: 'fee', amount: total.amount, currency: total.currency }] : [],
    totalFee: total,
    destinationAmount: null,
    effectiveRate: null,
    expiresAt: null,
  };
}

describe('resolveTransferFeeInSendCurrency', () => {
  it('returns the fee unchanged when it is already in the send currency (no rate call)', async () => {
    const getRate = vi.fn();
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote({ amount: '5', currency: 'USDT' }),
      sendCurrency: 'usdt',
      getRate,
    });
    expect(r).toBe(5);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('converts a funding-asset fee (USDC) into the send crypto (USDT) via the rate', async () => {
    const getRate = vi.fn(async () => rate('1')); // 1 USDT per USDC
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote({ amount: '25', currency: 'USDC' }),
      sendCurrency: 'usdt',
      getRate,
    });
    expect(r).toBe(25);
    expect(getRate).toHaveBeenCalledWith('usdc', 'usdt');
  });

  it('converts into a non-stablecoin send currency (NGN) at the looked-up rate', async () => {
    const getRate = vi.fn(async () => rate('1500')); // 1500 NGN per USDC
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote({ amount: '25', currency: 'USDC' }),
      sendCurrency: 'ngn',
      getRate,
    });
    expect(r).toBe(37500);
  });

  it('returns 0 for a genuine zero fee (known, not unavailable)', async () => {
    const getRate = vi.fn();
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote({ amount: '0', currency: 'USDC' }),
      sendCurrency: 'usdt',
      getRate,
    });
    expect(r).toBe(0);
    expect(getRate).not.toHaveBeenCalled();
  });

  it('returns null (fail-soft) when the fee is unavailable', async () => {
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote(null, true),
      sendCurrency: 'usdt',
      getRate: vi.fn(),
    });
    expect(r).toBeNull();
  });

  it('returns null when the fee quote is null', async () => {
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: null,
      sendCurrency: 'usdt',
      getRate: vi.fn(),
    });
    expect(r).toBeNull();
  });

  it('returns null when totalFee is null (multi-currency / no single total)', async () => {
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote(null),
      sendCurrency: 'usdt',
      getRate: vi.fn(),
    });
    expect(r).toBeNull();
  });

  it('returns null (fail-soft) when the conversion rate is unavailable', async () => {
    const getRate = vi.fn(async () => null);
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote({ amount: '25', currency: 'USDC' }),
      sendCurrency: 'btc',
      getRate,
    });
    expect(r).toBeNull();
  });

  it('returns null when the conversion rate is non-positive or unparseable', async () => {
    expect(
      await resolveTransferFeeInSendCurrency({
        feeQuote: quote({ amount: '25', currency: 'USDC' }),
        sendCurrency: 'btc',
        getRate: vi.fn(async () => rate('0')),
      }),
    ).toBeNull();
    expect(
      await resolveTransferFeeInSendCurrency({
        feeQuote: quote({ amount: '25', currency: 'USDC' }),
        sendCurrency: 'btc',
        getRate: vi.fn(async () => rate('not-a-number')),
      }),
    ).toBeNull();
  });

  it('returns null for an unparseable fee amount', async () => {
    const r = await resolveTransferFeeInSendCurrency({
      feeQuote: quote({ amount: 'abc', currency: 'USDC' }),
      sendCurrency: 'usdt',
      getRate: vi.fn(),
    });
    expect(r).toBeNull();
  });
});
