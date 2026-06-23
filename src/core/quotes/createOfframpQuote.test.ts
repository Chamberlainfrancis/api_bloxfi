import { describe, it, expect, vi } from 'vitest';
import { createOfframpQuote } from '@/core/quotes/createOfframpQuote';
import type { GetOfframpRatesResponse } from '@/types/offramp';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';

vi.mock('@/db/repositories/rampQuote.repo', () => ({
  createRampQuote: vi.fn(async ({ payload }) => ({
    id: 'q_1',
    expiresAt: new Date('2026-06-23T01:00:00Z'),
    payload,
  })),
}));

function rateResponse(conversionRate: string): GetOfframpRatesResponse {
  return {
    fromCurrency: 'usdt',
    toCurrency: 'eur',
    conversionRate,
    inverseRate: String(1 / (parseFloat(conversionRate) || 1)),
    rateValidUntil: new Date('2026-06-23T00:30:00Z').toISOString(),
    minimumAmount: '10',
    maximumAmount: '100000',
    estimatedProcessingTime: '1-3 business days',
    availableRails: [],
  } as unknown as GetOfframpRatesResponse;
}

function makeOptions() {
  return {
    getRateFromPalremit: vi.fn(async () => rateResponse('0.85')),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    getProviderWithdrawalFeeQuote: vi.fn(async () => null),
    convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
  };
}

describe('createOfframpQuote', () => {
  it('records rate-spread profit on the snapshot (USDC-normalized)', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.85'), marketRate: '0.87', rateCurrency: 'EUR', perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => null),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount * 1.1),
    };
    await createOfframpQuote(
      { fromCurrency: 'usdt', toCurrency: 'eur', fromChain: 'TRC20', amount: 1000,
        corridor: { country: 'DE', destinationType: 'local_bank' },
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' } },
      options as never
    );
    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0].payload as {
      profit?: { currency: string; amountInCurrency: string; amountUsdc: string | null; marketRate: string };
    };
    // profit_eur = 1000×0.87 − 1000×0.85 = 20 EUR; usdc = 20×1.1 = 22
    expect(snapshot.profit?.currency).toBe('eur');
    expect(snapshot.profit?.amountInCurrency).toBe('20.00000000');
    expect(snapshot.profit?.amountUsdc).toBe('22.00000000');
    expect(snapshot.profit?.marketRate).toBe('0.87');
  });

  it('denominates the platform fee in the source crypto (fromCurrency) at crypto precision', async () => {
    await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'DE', destinationType: 'local_bank' },
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
      },
      makeOptions()
    );

    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls[0][0].payload as {
      fees: { platformFee: { currency: string; amount: string; settlementCurrency: string } };
      quote: { platformFee?: { currency?: string; amount: string } };
    };

    expect(snapshot.fees.platformFee.currency).toBe('usdt');     // source crypto
    expect(snapshot.fees.platformFee.amount).toBe('10.00000000'); // 1% of 1000, 8dp
    expect(snapshot.fees.platformFee.settlementCurrency).toBe('USDC');
    expect(snapshot.quote.platformFee?.currency).toBe('usdt');
    expect(snapshot.quote.platformFee?.amount).toBe('10.00000000');
  });
});
