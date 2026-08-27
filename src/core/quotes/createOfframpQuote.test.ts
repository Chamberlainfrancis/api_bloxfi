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

function rateResponse(
  conversionRate: string,
  toCurrency: string = 'eur'
): GetOfframpRatesResponse {
  return {
    fromCurrency: 'usdt',
    toCurrency,
    conversionRate,
    inverseRate: String(1 / (parseFloat(conversionRate) || 1)),
    rateValidUntil: new Date('2026-06-23T00:30:00Z').toISOString(),
    minimumAmount: '10',
    maximumAmount: '100000',
    estimatedProcessingTime: '1-3 business days',
    availableRails: [],
  } as unknown as GetOfframpRatesResponse;
}

const ACC = '55555555-5555-4555-8555-555555555555';

function makeOptions(
  account: {
    asset: string;
    country: string;
    destinationType?: string;
    beneficiaryType?: 'individual' | 'business';
  } = { asset: 'NGN', country: 'NG' }
) {
  return {
    getRateFromPalremit: vi.fn(async () => rateResponse('1450', 'ngn')),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    getProviderWithdrawalFeeQuote: vi.fn(async () => null),
    convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
    loadOfframpAccountCorridor: vi.fn(async () => ({
      asset: account.asset,
      country: account.country,
      destinationType: account.destinationType ?? 'local_bank',
      beneficiaryType: account.beneficiaryType ?? 'individual',
    })),
  };
}

describe('createOfframpQuote — USD→EUR pair markup', () => {
  it('applies 25 bps below marketRate on USDT → EUR', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.871'),
        marketRate: '0.87',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [],
        totalFee: { amount: '0', currency: 'USDC' },
        destinationAmount: '870.00',
        effectiveRate: '0.87',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({ asset: 'EUR', country: 'DE' }).loadOfframpAccountCorridor,
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'DE', destinationType: 'local_bank' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    const customer = 0.87 * 0.9975;
    expect(Number(result.baseConversionRate)).toBeCloseTo(customer, 10);
    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0]
      .payload as {
      baseConversionRate: string;
      quote: { receiveGross: { amount: string } };
    };
    expect(Number(snapshot.baseConversionRate)).toBeCloseTo(customer, 10);
    expect(Number(snapshot.quote.receiveGross.amount)).toBeCloseTo(1000 * customer, 2);
  });

  it('floors EUR conversion at the live OwlPay effective_rate, then 25 bps', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.8681172675'),
        marketRate: '0.870293',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [{ kind: 'transfer fee', amount: '0', currency: 'USDC' }],
        totalFee: { amount: '0', currency: 'USDC' },
        destinationAmount: '868.12',
        effectiveRate: '0.855861',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({ asset: 'EUR', country: 'FR' }).loadOfframpAccountCorridor,
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'FR', destinationType: 'local_bank' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    const customer = 0.855861 * 0.9975;
    expect(Number(result.baseConversionRate)).toBeCloseTo(customer, 8);
    expect(Number(result.quote.receiveNet.amount)).toBeCloseTo(1000 * customer, 2);
  });

  it('floors a 0.85846 mid at OwlPay 0.855 so the customer rate is below OwlPay', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.856314'),
        marketRate: '0.85846',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [{ kind: 'transfer fee', amount: '0', currency: 'USDC' }],
        totalFee: { amount: '0', currency: 'USDC' },
        destinationAmount: '856.31',
        effectiveRate: '0.855',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({ asset: 'EUR', country: 'FR' }).loadOfframpAccountCorridor,
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'FR', destinationType: 'local_bank' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    const owlpay = 0.855;
    const customer = owlpay * 0.9975;
    expect(Number(result.baseConversionRate)).toBeCloseTo(customer, 8);
    expect(Number(result.baseConversionRate)).toBeLessThan(owlpay);
    expect(Number(result.baseConversionRate)).not.toBeCloseTo(0.85846 * 0.9975, 5);
  });

  it('rejects EUR quotes when OwlPay effective_rate is missing', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.856314'),
        marketRate: '0.85846',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => null),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({ asset: 'EUR', country: 'FR' }).loadOfframpAccountCorridor,
    };
    await expect(
      createOfframpQuote(
        {
          fromCurrency: 'usdt',
          toCurrency: 'eur',
          fromChain: 'TRC20',
          amount: 1000,
          corridor: { country: 'FR', destinationType: 'local_bank' },
          accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
        },
        options as never
      )
    ).rejects.toThrow('UNFAVORABLE_RATE');
  });
});

describe('createOfframpQuote — CNY executable floor', () => {
  it('floors USDT → CNY at OwlPay so a WIRE quote is solvent', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('6.6956196', 'cny'),
        marketRate: '6.703664',
        rateCurrency: 'CNY',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [{ kind: 'SWIFT fee', amount: '25', currency: 'USDC' }],
        totalFee: { amount: '25', currency: 'USDC' },
        destinationAmount: '6200.00',
        effectiveRate: '6.20',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({
        asset: 'CNY',
        country: 'CN',
        destinationType: 'wire',
      }).loadOfframpAccountCorridor,
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'cny',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'CN', destinationType: 'wire' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    expect(Number(result.baseConversionRate)).toBeCloseTo(6.2, 10);
    expect(Number(result.baseConversionRate)).toBeLessThanOrEqual(6.2);
    expect(Number(result.quote.receiveNet.amount)).toBeLessThanOrEqual(1000 * 6.2);
  });

  it('locks a 1000 USDT → CNY WIRE quote at today’s live OwlPay rate instead of 422ing', async () => {
    // Live 2026-08-27: currency-api b2b 6.69527602, OwlPay WIRE at 6695 CNY
    // effective_rate 6.533057. Before the floor this throws UNFAVORABLE_RATE.
    const cnyRate = {
      ...rateResponse('6.69527602', 'cny'),
      marketRate: '6.70332',
      rateCurrency: 'CNY',
      perCurrency: 'USDT',
    };
    const options = {
      getRateFromPalremit: vi.fn(async (from: string, to: string) => {
        if (from === 'usdc' && to === 'usdt') {
          return { ...rateResponse('1', 'usdt'), conversionRate: '1' };
        }
        return cnyRate;
      }),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [{ kind: 'SWIFT fee', amount: '25', currency: 'USDC' }],
        totalFee: { amount: '25', currency: 'USDC' },
        destinationAmount: '6695.28',
        effectiveRate: '6.53305700',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({
        asset: 'CNY',
        country: 'CN',
        destinationType: 'wire',
      }).loadOfframpAccountCorridor,
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'cny',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'CN', destinationType: 'wire' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    expect(Number(result.baseConversionRate)).toBeCloseTo(6.533057, 6);
    expect(Number(result.quote.sendNet.amount)).toBeCloseTo(975, 2);
    expect(Number(result.quote.receiveNet.amount)).toBeCloseTo(975 * 6.533057, 2);
  });

  it('keeps the CNY B2B rate when it is already at or below OwlPay', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('6.6956196', 'cny'),
        marketRate: '6.703664',
        rateCurrency: 'CNY',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [{ kind: 'SWIFT fee', amount: '25', currency: 'USDC' }],
        totalFee: { amount: '25', currency: 'USDC' },
        destinationAmount: '6700.00',
        effectiveRate: '6.80',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({
        asset: 'CNY',
        country: 'CN',
        destinationType: 'wire',
      }).loadOfframpAccountCorridor,
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'cny',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'CN', destinationType: 'wire' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    expect(Number(result.baseConversionRate)).toBeCloseTo(6.6956196, 6);
  });
});

describe('createOfframpQuote', () => {
  it('records rate-spread profit on the snapshot (USDC-normalized)', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('1450', 'ngn'), marketRate: '1460', rateCurrency: 'NGN', perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => null),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount * 1.1),
      loadOfframpAccountCorridor: makeOptions({ asset: 'NGN', country: 'NG' }).loadOfframpAccountCorridor,
    };
    await createOfframpQuote(
      { fromCurrency: 'usdt', toCurrency: 'ngn', fromChain: 'TRC20', amount: 1000,
        corridor: { country: 'NG', destinationType: 'local_bank' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' } },
      options as never
    );
    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0].payload as {
      profit?: { currency: string; amountInCurrency: string; amountUsdc: string | null; marketRate: string };
    };
    // profit_ngn = 1000×1460 − 1000×1450 = 10000 NGN; usdc = 10000×1.1 = 11000
    expect(snapshot.profit?.currency).toBe('ngn');
    expect(snapshot.profit?.amountInCurrency).toBe('10000.00000000');
    expect(snapshot.profit?.amountUsdc).toBe('11000.00000000');
    expect(snapshot.profit?.marketRate).toBe('1460');
  });

  it('locks EUR quotes that floor to the executable OwlPay rate', async () => {
    const options = {
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.87'),
        marketRate: '0.87',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [],
        totalFee: { amount: '0', currency: 'USDC' },
        destinationAmount: '870.00',
        // Worse than the customer rate we would otherwise lock, but still
        // above the floored market so createOfframpQuote reprices first.
        // Use a rate so low that even after floor, receiveNet/rate > sendNet
        // cannot happen (floor forces customer ≤ executable). This documents
        // that a missing floor would have thrown — covered by offrampQuoteSolvency.
        effectiveRate: '0.87',
        expiresAt: null,
      })),
      convertToUsdc: vi.fn(async (_from: string, amount: number) => amount),
      loadOfframpAccountCorridor: makeOptions({ asset: 'EUR', country: 'FR' }).loadOfframpAccountCorridor,
    };
    await expect(
      createOfframpQuote(
        {
          fromCurrency: 'usdt',
          toCurrency: 'eur',
          fromChain: 'TRC20',
          amount: 1000,
          corridor: { country: 'FR', destinationType: 'local_bank' },
          accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
        },
        options as never
      )
    ).resolves.toBeTruthy();
  });

  it('denominates the platform fee in the source crypto (fromCurrency) at crypto precision', async () => {
    await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'ngn',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'NG', destinationType: 'local_bank' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
      },
      makeOptions()
    );

    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0].payload as {
      fees: { platformFee: { currency: string; amount: string; settlementCurrency: string } };
      quote: { platformFee?: { currency?: string; amount: string } };
    };

    expect(snapshot.fees.platformFee.currency).toBe('usdt');     // source crypto
    expect(snapshot.fees.platformFee.amount).toBe('10.00000000'); // 1% of 1000, 8dp
    expect(snapshot.fees.platformFee.settlementCurrency).toBe('USDC');
    expect(snapshot.quote.platformFee?.currency).toBe('usdt');
    expect(snapshot.quote.platformFee?.amount).toBe('10.00000000');
  });

  it('defaults settlementCurrency to the USDT/USDC source when platformFee.currency is omitted', async () => {
    await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'ngn',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: { country: 'NG', destinationType: 'local_bank' },
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', network: 'TRC20' },
      },
      makeOptions()
    );

    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0].payload as {
      fees: { platformFee: { currency: string; settlementCurrency: string; settlementNetwork?: string } };
    };

    expect(snapshot.fees.platformFee.currency).toBe('usdt');
    expect(snapshot.fees.platformFee.settlementCurrency).toBe('USDT');
    expect(snapshot.fees.platformFee.settlementNetwork).toBe('TRC20');
  });

  it('quotes OwlPay using the payout account corridor when accountId is sent', async () => {
    const options = {
      ...makeOptions(),
      getRateFromPalremit: vi.fn(async () => ({
        ...rateResponse('0.871'),
        marketRate: '0.87',
        rateCurrency: 'EUR',
        perCurrency: 'USDT',
      })),
      getProviderWithdrawalFeeQuote: vi.fn(async () => ({
        feeUnavailable: false,
        fees: [],
        totalFee: { amount: '0', currency: 'USDC' },
        destinationAmount: '867.83',
        effectiveRate: '0.87',
        expiresAt: null,
      })),
      loadOfframpAccountCorridor: vi.fn(async () => ({
        asset: 'EUR',
        country: 'DE',
        destinationType: 'local_bank',
        beneficiaryType: 'business' as const,
      })),
    };
    const result = await createOfframpQuote(
      {
        fromCurrency: 'usdt',
        toCurrency: 'eur',
        fromChain: 'TRC20',
        amount: 1000,
        corridor: {},
        accountId: ACC,
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      },
      options as never
    );
    expect(options.loadOfframpAccountCorridor).toHaveBeenCalledWith(
      ACC
    );
    expect(options.getProviderWithdrawalFeeQuote).toHaveBeenCalledWith(
      expect.objectContaining({
        asset: 'eur',
        country: 'DE',
        destinationType: 'local_bank',
        beneficiaryType: 'business',
      })
    );
    expect(Number(result.baseConversionRate)).toBeCloseTo(0.87 * 0.9975, 8);
    const snapshot = vi.mocked(rampQuoteRepo.createRampQuote).mock.calls.at(-1)![0]
      .payload as { corridor: { country: string; destinationType: string } };
    expect(snapshot.corridor).toEqual({
      country: 'DE',
      destinationType: 'local_bank',
      beneficiaryType: 'business',
    });
  });

  it('throws OFFRAMP_ACCOUNT_NOT_FOUND when accountId does not resolve', async () => {
    await expect(
      createOfframpQuote(
        {
          fromCurrency: 'usdt',
          toCurrency: 'eur',
          fromChain: 'TRC20',
          amount: 1000,
          corridor: {},
          accountId: ACC,
          platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
        },
        { ...makeOptions(), loadOfframpAccountCorridor: vi.fn(async () => null) } as never
      )
    ).rejects.toThrow('OFFRAMP_ACCOUNT_NOT_FOUND');
  });
});
