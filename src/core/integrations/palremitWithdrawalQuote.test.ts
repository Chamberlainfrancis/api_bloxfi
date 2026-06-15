import { describe, it, expect, vi } from 'vitest';
import { fetchPalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

function reqReturning(status: number, data: unknown): PalremitLiquidityRequestFn {
  return vi.fn(async () => ({ status, data })) as unknown as PalremitLiquidityRequestFn;
}

describe('fetchPalremitWithdrawalFeeQuote', () => {
  it('maps a successful provider-neutral quote', async () => {
    const req = reqReturning(200, {
      asset: 'NGN',
      amount: 150000,
      destination_type: 'local_bank',
      fee_unavailable: false,
      destination_asset: 'NGN',
      destination_amount: '150000',
      effective_rate: '1500',
      fees: [
        { kind: 'network_fee', amount: '1800.00', currency: 'NGN' },
        { kind: 'conversion_fee', amount: '450.00', currency: 'NGN' },
      ],
      total_fee: { amount: '2250.00', currency: 'NGN' },
      expires_at: '2026-06-11T12:30:00.000Z',
    });
    const r = await fetchPalremitWithdrawalFeeQuote(req, {
      asset: 'ngn',
      amount: 150000,
      destinationType: 'local_bank',
      country: 'ng',
      beneficiaryType: 'individual',
    });
    expect(r).not.toBeNull();
    expect(r!.feeUnavailable).toBe(false);
    expect(r!.totalFee).toEqual({ amount: '2250.00', currency: 'NGN' });
    expect(r!.fees).toHaveLength(2);
    expect(r!.effectiveRate).toBe('1500');
  });

  it('sends an uppercased asset/country and the corridor fields', async () => {
    const req = reqReturning(200, { fee_unavailable: false, fees: [], total_fee: null });
    await fetchPalremitWithdrawalFeeQuote(req, {
      asset: 'usd',
      amount: 1000,
      destinationType: 'wire',
      country: 'us',
      beneficiaryType: 'business',
    });
    expect(req).toHaveBeenCalledWith('/v1/withdrawals/quote', {
      method: 'POST',
      body: {
        asset: 'USD',
        amount: 1000,
        destination_type: 'wire',
        country: 'US',
        beneficiary_type: 'business',
      },
    });
  });

  it('passes through fee_unavailable', async () => {
    const req = reqReturning(200, { fee_unavailable: true, fees: [], total_fee: null });
    const r = await fetchPalremitWithdrawalFeeQuote(req, {
      asset: 'USDT',
      amount: 50,
      destinationType: 'crypto_address',
      network: 'ERC20',
    });
    expect(r!.feeUnavailable).toBe(true);
    expect(r!.totalFee).toBeNull();
  });

  it('returns null on non-200 (caller fails soft)', async () => {
    const req = reqReturning(503, { error: 'provider_unavailable' });
    const r = await fetchPalremitWithdrawalFeeQuote(req, {
      asset: 'NGN',
      amount: 1000,
      destinationType: 'local_bank',
      country: 'NG',
    });
    expect(r).toBeNull();
  });

  it('returns null when the request throws', async () => {
    const req = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as PalremitLiquidityRequestFn;
    const r = await fetchPalremitWithdrawalFeeQuote(req, {
      asset: 'NGN',
      amount: 1000,
      destinationType: 'local_bank',
      country: 'NG',
    });
    expect(r).toBeNull();
  });

  it('returns null for a non-positive amount without calling the provider', async () => {
    const req = reqReturning(200, {});
    const r = await fetchPalremitWithdrawalFeeQuote(req, {
      asset: 'NGN',
      amount: 0,
      destinationType: 'local_bank',
      country: 'NG',
    });
    expect(r).toBeNull();
    expect(req).not.toHaveBeenCalled();
  });
});
