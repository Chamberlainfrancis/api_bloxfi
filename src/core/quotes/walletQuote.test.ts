import { beforeEach, describe, it, expect, vi } from 'vitest';
import { createOfframpQuote, walletQuoteExpiry, WALLET_QUOTE_TTL_MINUTES } from '@/core/quotes/createOfframpQuote';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';
import { setPairMarkupRulesFromSettings } from '@/core/quotes/pairMarkupStore';
import { TEST_PAIR_MARKUP_ROWS } from '@/test/pairMarkupFixture';
import { createOfframpQuoteBodySchema } from '@/api/v1/offramps/schemas';

vi.mock('@/db/repositories/rampQuote.repo', () => ({
  createRampQuote: vi.fn(async ({ payload, expiresAt }) => ({ id: 'q_w', expiresAt, payload })),
}));

beforeEach(() => {
  vi.mocked(rampQuoteRepo.createRampQuote).mockClear();
  setPairMarkupRulesFromSettings([
    ...TEST_PAIR_MARKUP_ROWS,
    { fiat: 'NGN', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 20, requireProviderRate: false },
    { fiat: 'USD', side: 'sell', cryptos: 'USD,USDT,USDC', markupBps: 20, requireProviderRate: false },
  ]);
});

const ACC = '55555555-5555-4555-8555-555555555555';

function options(toCurrency: string, rateValidUntil: string) {
  return {
    getRateFromPalremit: vi.fn(async () => ({
      fromCurrency: 'usdt',
      toCurrency,
      conversionRate: '1450',
      inverseRate: String(1 / 1450),
      rateValidUntil,
      minimumAmount: '10',
      maximumAmount: '100000',
      estimatedProcessingTime: '1-3 business days',
      availableRails: [],
    })),
    resolvePalremitNetwork: vi.fn(async () => 'BEP20'),
    getProviderWithdrawalFeeQuote: vi.fn(async () => ({
      feeUnavailable: false,
      fees: [],
      totalFee: { amount: '0', currency: 'USDC' },
      destinationAmount: null,
      effectiveRate: null,
      expiresAt: null,
    })),
    convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
    loadOfframpAccountCorridor: vi.fn(async () => ({
      asset: toCurrency.toUpperCase(),
      country: 'NG',
      destinationType: 'local_bank',
      beneficiaryType: 'individual' as const,
    })),
  };
}

const input = (fundingSource?: 'wallet' | 'deposit') => ({
  fromCurrency: 'usdt',
  toCurrency: 'ngn',
  fromChain: 'BEP20',
  amount: 100,
  corridor: { country: 'NG', destinationType: 'local_bank' },
  accountId: ACC,
  platformFee: { type: 'PERCENTAGE' as const, value: 0, walletAddress: '0xFee', network: 'BEP20' },
  ...(fundingSource ? { fundingSource } : {}),
});

describe('wallet-funded offramp quotes', () => {
  it('walletQuoteExpiry caps at 5 minutes, or the rate expiry when sooner', () => {
    const now = Date.parse('2026-11-20T10:00:00Z');
    expect(walletQuoteExpiry(new Date(now + 30 * 60_000), now).getTime()).toBe(now + WALLET_QUOTE_TTL_MINUTES * 60_000);
    expect(walletQuoteExpiry(new Date(now + 2 * 60_000), now).getTime()).toBe(now + 2 * 60_000);
  });

  it('a wallet quote lasts 5 minutes and is tagged on the snapshot', async () => {
    const rateEnd = new Date(Date.now() + 30 * 60_000).toISOString();
    const before = Date.now();
    const res = await createOfframpQuote(input('wallet'), options('ngn', rateEnd) as never);
    const ttl = Date.parse(res.expiresAt) - before;
    expect(ttl).toBeGreaterThan(4.9 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000 + 1000);
    const saved = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls[0][0];
    expect((saved.payload as { fundingSource?: string }).fundingSource).toBe('wallet');
  });

  it('a quote without fundingSource keeps the provider rate lifetime', async () => {
    const rateEnd = new Date(Date.now() + 30 * 60_000).toISOString();
    const res = await createOfframpQuote(input(), options('ngn', rateEnd) as never);
    expect(res.expiresAt).toBe(rateEnd);
    const saved = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls[0][0];
    expect((saved.payload as { fundingSource?: string }).fundingSource).toBeUndefined();
  });

  it('schema accepts fundingSource and refuses it with flow', () => {
    const base = {
      fromCurrency: 'USDT', toCurrency: 'NGN', fromChain: 'BEP20', amount: 100, accountId: ACC,
      platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', network: 'BEP20' },
    };
    const ok = createOfframpQuoteBodySchema.safeParse({ ...base, fundingSource: 'wallet' });
    expect(ok.success && ok.data.fundingSource).toBe('wallet');
    const bad = createOfframpQuoteBodySchema.safeParse({ ...base, fundingSource: 'wallet', flow: 'FIAT_TO_FIAT' });
    expect(bad.success).toBe(false);
  });
});
