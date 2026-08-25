import { describe, it, expect, vi } from 'vitest';
import { createOnrampQuote } from '@/core/quotes/createOnrampQuote';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';
import type { AccountCapabilities } from '@/types/account';
import type { OnrampQuoteSnapshot } from '@/types/quote';

vi.mock('@/db/repositories/rampQuote.repo', () => ({
  createRampQuote: vi.fn(async ({ payload }) => ({
    id: 'q_on_1',
    expiresAt: new Date('2026-08-14T01:00:00Z'),
    payload,
  })),
}));

const ACC = '44444444-4444-4444-8444-444444444444';

const usdNamed: AccountCapabilities = {
  usdNamedDeposit: { status: 'pending', failureReason: null },
};

function lastSnapshot(): OnrampQuoteSnapshot {
  return vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0]
    .payload as OnrampQuoteSnapshot;
}

function makeOptions(overrides?: Partial<Parameters<typeof createOnrampQuote>[1]>) {
  return {
    getQuoteFromPalremit: vi.fn(async () => ({
      conversionRate: '1',
      conversion: 100,
      marketRate: '1',
      rateCurrency: 'USD',
      perCurrency: 'USDT',
    })),
    resolvePalremitNetwork: vi.fn(async () => 'MATIC'),
    getProviderWithdrawalFeeQuote: vi.fn(async () => null),
    convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
    ...overrides,
  };
}

const quoteInput = {
  fromCurrency: 'usd',
  toCurrency: 'usdt',
  amount: 100,
  destinationChain: 'MATIC',
  platformFee: { type: 'PERCENTAGE' as const, value: 0, walletAddress: '0xFee' },
};

describe('createOnrampQuote — account markup', () => {
  it('keeps the B2B rate when accountId is omitted', async () => {
    const result = await createOnrampQuote(quoteInput, makeOptions());
    expect(result.conversionRate).toBe('1');
    const snap = lastSnapshot();
    expect(snap.accountId).toBeUndefined();
    expect(snap.markup).toBeUndefined();
    expect(snap.quote.receiveGross.amount).toBe('100.00000000');
  });

  it('locks B2B and stores accountId when the Account has no named capability', async () => {
    await createOnrampQuote(
      { ...quoteInput, accountId: ACC },
      makeOptions({
        loadOnrampAccountForMarkup: async () => ({
          id: ACC,
          currency: 'USD',
          railType: 'onramp',
          capabilities: undefined,
        }),
      })
    );
    const snap = lastSnapshot();
    expect(snap.accountId).toBe(ACC);
    expect(snap.markup).toBeNull();
    expect(snap.conversionRate).toBe('1');
    expect(snap.quote.receiveGross.amount).toBe('100.00000000');
  });

  it('applies 40 bps on marketRate for a usdNamedDeposit Account', async () => {
    const result = await createOnrampQuote(
      { ...quoteInput, accountId: ACC },
      makeOptions({
        loadOnrampAccountForMarkup: async () => ({
          id: ACC,
          currency: 'USD',
          railType: 'onramp',
          capabilities: usdNamed,
        }),
      })
    );
    expect(result.conversionRate).toBe('1.004');
    const snap = lastSnapshot();
    expect(snap.accountId).toBe(ACC);
    expect(snap.markup).toEqual({
      capability: 'usdNamedDeposit',
      currency: 'USD',
      markup: 0.004,
    });
    expect(snap.conversionRate).toBe('1.004');
    expect(snap.marketRate).toBe('1');
    expect(Number(snap.quote.receiveGross.amount)).toBeCloseTo(100 / 1.004, 6);
    expect(snap.profit?.customerRate).toBe('1.004');
    expect(snap.profit?.marketRate).toBe('1');
  });

  it('throws ONRAMP_ACCOUNT_NOT_FOUND when accountId does not resolve', async () => {
    await expect(
      createOnrampQuote(
        { ...quoteInput, accountId: ACC },
        makeOptions({
          loadOnrampAccountForMarkup: async () => null,
        })
      )
    ).rejects.toThrow('ONRAMP_ACCOUNT_NOT_FOUND');
  });

  it('deducts platformFee from the marked-up receiveGross', async () => {
    await createOnrampQuote(
      {
        ...quoteInput,
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' },
      },
      makeOptions({
        loadOnrampAccountForMarkup: async () => ({
          id: ACC,
          currency: 'USD',
          railType: 'onramp',
          capabilities: usdNamed,
        }),
      })
    );
    const snap = lastSnapshot();
    const gross = 100 / 1.004;
    expect(Number(snap.quote.receiveGross.amount)).toBeCloseTo(gross, 6);
    expect(Number(snap.quote.platformFee?.amount)).toBeCloseTo(gross * 0.01, 6);
    expect(Number(snap.quote.baseReceiveNet?.amount)).toBeCloseTo(gross * 0.99, 6);
  });

  it('applies 25 bps on marketRate for EUR → USDT even without accountId', async () => {
    const result = await createOnrampQuote(
      { ...quoteInput, fromCurrency: 'eur', toCurrency: 'usdt' },
      makeOptions({
        getQuoteFromPalremit: vi.fn(async () => ({
          conversionRate: '0.871',
          conversion: 114.81,
          marketRate: '0.87',
          rateCurrency: 'EUR',
          perCurrency: 'USDT',
        })),
      })
    );
    const customer = 0.87 * 1.0025;
    expect(Number(result.conversionRate)).toBeCloseTo(customer, 10);
    const snap = lastSnapshot();
    expect(Number(snap.conversionRate)).toBeCloseTo(customer, 10);
    expect(snap.marketRate).toBe('0.87');
    expect(Number(snap.quote.receiveGross.amount)).toBeCloseTo(100 / customer, 6);
  });

  it('throws PALREMIT_RATES_UNAVAILABLE when named markup hits and mid is missing', async () => {
    await expect(
      createOnrampQuote(
        { ...quoteInput, accountId: ACC },
        makeOptions({
          getQuoteFromPalremit: vi.fn(async () => ({
            conversionRate: '1',
            conversion: 100,
          })),
          loadOnrampAccountForMarkup: async () => ({
            id: ACC,
            currency: 'USD',
            railType: 'onramp',
            capabilities: usdNamed,
          }),
        })
      )
    ).rejects.toThrow('PALREMIT_RATES_UNAVAILABLE');
  });
});

describe('createOnrampQuote — deposit window', () => {
  it('locks GHS quotes for 24h and USD quotes for 3h', async () => {
    const ghsNow = Date.now();
    await createOnrampQuote(
      { ...quoteInput, fromCurrency: 'ghs', toCurrency: 'usdt' },
      makeOptions({
        getQuoteFromPalremit: vi.fn(async () => ({
          conversionRate: '12',
          conversion: 8.3,
        })),
      })
    );
    const ghsSnap = lastSnapshot();
    const ghsMs = new Date(ghsSnap.rateValidUntil).getTime() - ghsNow;
    expect(ghsMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 2000);
    expect(ghsMs).toBeLessThan(24 * 60 * 60 * 1000 + 5000);

    const usdNow = Date.now();
    await createOnrampQuote(quoteInput, makeOptions());
    const usdSnap = lastSnapshot();
    const usdMs = new Date(usdSnap.rateValidUntil).getTime() - usdNow;
    expect(usdMs).toBeGreaterThanOrEqual(180 * 60 * 1000 - 2000);
    expect(usdMs).toBeLessThan(180 * 60 * 1000 + 5000);
  });
});
