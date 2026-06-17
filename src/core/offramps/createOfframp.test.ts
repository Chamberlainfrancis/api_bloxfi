import { describe, it, expect, vi } from 'vitest';
import { createOfframp } from '@/core/offramps/createOfframp';
import type {
  OfframpRepoCreate,
  UserRepoForOfframp,
  AccountRepoForOfframp,
  WalletRepoForOfframp,
  KybRepoForOfframp,
  CreateOfframpOptions,
} from '@/core/offramps/createOfframp';
import type { CreateOfframpRequest, GetOfframpRatesResponse } from '@/types/offramp';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

const VALID_PROVIDER_PAYOUT = {
  provider: 'palremit',
  schemaVersion: 2,
  corridor: { asset: 'NGN', country: 'NG', destinationType: 'local_bank', beneficiaryType: 'individual' },
  destination: { account_number: '0123456789', bank_code: '058' },
};

function rateResponse(from: string, to: string, conversionRate: string): GetOfframpRatesResponse {
  return {
    fromCurrency: from,
    toCurrency: to,
    conversionRate,
    inverseRate: String(1 / (parseFloat(conversionRate) || 1)),
    rateValidUntil: new Date(Date.now() + 300000).toISOString(),
    minimumAmount: '10',
    maximumAmount: '100000',
    estimatedProcessingTime: '1-3 business days',
    availableRails: [],
  } as unknown as GetOfframpRatesResponse;
}

// Direction-aware rate mock: the main offramp rate (usdt→ngn) and the fee
// conversion rate (the fee's funding asset → send currency). Pairs not listed
// return null (cannot be priced).
const RATES: Record<string, string> = {
  'usdt->ngn': '1500',
  'usdc->usdt': '1', // USDC funding-asset fee → USDT send (≈1:1)
};

function makeDeps(feeQuote: PalremitWithdrawalFeeQuote | null | undefined) {
  const created: { data?: Parameters<OfframpRepoCreate['createOfframp']>[0] } = {};
  const offrampRepo: OfframpRepoCreate = {
    createOfframp: vi.fn(async (data) => {
      created.data = data;
      return {
        id: 'off_1',
        requestId: data.requestId,
        txnRef: data.txnRef,
        userId: data.userId,
        status: data.status,
        source: data.source,
        destination: data.destination,
        rateInformation: data.rateInformation,
        depositInstructions: data.depositInstructions ?? null,
        timeline: data.timeline ?? null,
        fees: data.fees ?? null,
        receipt: null,
        refundDetails: null,
        failedReason: null,
        lpReference: data.lpReference ?? null,
        createdAt: new Date('2026-06-11T00:00:00Z'),
        updatedAt: new Date('2026-06-11T00:00:00Z'),
      };
    }),
  };
  const userRepo: UserRepoForOfframp = {
    findUserById: vi.fn(async () => ({
      id: 'user_1',
      businessInfo: { email: 'biz@example.com', legalName: 'Acme Ltd' },
      legalRepresentative: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    })),
  };
  const accountRepo: AccountRepoForOfframp = {
    findOfframpAccountByIdAndUser: vi.fn(async () => ({
      id: 'acc_1',
      userId: 'user_1',
      currency: 'ngn',
      accountHolder: { name: 'Ada Lovelace' },
      providerPayout: VALID_PROVIDER_PAYOUT,
      paymentRail: 'local_bank',
      accountType: 'bank',
    })),
  };
  const walletRepo: WalletRepoForOfframp = {
    findExternalWalletByIdAndUser: vi.fn(async () => ({
      id: 'wal_1',
      address: 'TXyz...',
      chain: 'TRC20',
      userId: 'user_1',
    })),
  };
  const kybRepo: KybRepoForOfframp = {
    getKybRailStatuses: vi.fn(async () => [{ rail: 'NGN', status: 'approved' }]),
  };
  const options: CreateOfframpOptions = {
    getRateFromPalremit: vi.fn(async (from: string, to: string) => {
      const cr = RATES[`${from}->${to}`];
      return cr ? rateResponse(from, to, cr) : null;
    }),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitDeposit: vi.fn(async () => ({
      depositInstructions: {
        address: 'TDeposit...',
        amount: '100',
        currency: 'USDT',
        network: 'TRC20',
        depositBy: new Date(Date.now() + 1e6).toISOString(),
        instruction: 'send',
      },
      correlationId: 'OFF-x',
      providerRefs: {},
    })),
    getProviderWithdrawalFeeQuote:
      feeQuote === undefined ? undefined : vi.fn(async () => feeQuote),
  };
  return { offrampRepo, userRepo, accountRepo, walletRepo, kybRepo, options, created };
}

const BODY: Omit<CreateOfframpRequest, 'requestId'> = {
  source: { userId: 'user_1', currency: 'usdt', amount: 100, chain: 'tron', externalWalletId: 'wal_1' },
  destination: { userId: 'user_1', currency: 'ngn', accountId: 'acc_1' },
  platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' },
} as unknown as Omit<CreateOfframpRequest, 'requestId'>;

// Baseline: 100 USDT − 1% platform = 99 net crypto; 99 × 1500 = 148,500 NGN
// gross (before the provider fee).
const FIAT_GROSS = 148500;

describe('createOfframp — provider fee deducted from the SEND crypto', () => {
  it('converts the funding-asset fee to the send crypto, deducts it there, and persists the itemized breakdown verbatim', async () => {
    // Provider fee is 5 USDC (funding asset) → at 1:1 → 5 USDT off the send.
    // Net crypto = 99 − 5 = 94 USDT; receive = 94 × 1500 = 141,000 NGN.
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [
        { kind: 'Wire fee', amount: '4.50', currency: 'USDC' },
        { kind: 'Commission fee', amount: '0.50', currency: 'USDC' },
      ],
      totalFee: { amount: '5.00', currency: 'USDC' },
      destinationAmount: '148500',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-1', BODY, d.options);

    const persisted = d.created.data!;
    // Receive reflects the fee taken off the SEND side then converted.
    expect((persisted.destination as { amount: number }).amount).toBe(94 * 1500);
    // The crypto the user sends is unchanged (sendGross stays 100).
    expect((persisted.source as { amount: number }).amount).toBe(100);
    const fees = persisted.fees as { transferFee?: { fees: unknown[]; total: unknown; unavailable: boolean } };
    expect(fees.transferFee?.unavailable).toBe(false);
    // Fee surfaced verbatim in its own (funding-asset) currency — not converted.
    expect(fees.transferFee?.total).toEqual({ amount: '5.00', currency: 'USDC' });
    expect(fees.transferFee?.fees).toHaveLength(2);
  });

  it('does not deduct when the fee is unavailable (fail-soft) and marks it unavailable', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: true,
      fees: [],
      totalFee: null,
      destinationAmount: null,
      effectiveRate: null,
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-2', BODY, d.options);

    const persisted = d.created.data!;
    expect((persisted.destination as { amount: number }).amount).toBe(FIAT_GROSS);
    const fees = persisted.fees as { transferFee?: { unavailable: boolean } };
    expect(fees.transferFee?.unavailable).toBe(true);
  });

  it('does not deduct when the quote call fails entirely (null)', async () => {
    const d = makeDeps(null);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-3', BODY, d.options);
    expect((d.created.data!.destination as { amount: number }).amount).toBe(FIAT_GROSS);
  });

  it('throws AMOUNT_TOO_LOW_AFTER_FEES when the fee (in send crypto) meets or exceeds the net send', async () => {
    // 100 USDC fee → 100 USDT; net send after platform fee is 99 USDT → too low.
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'Wire fee', amount: '100', currency: 'USDC' }],
      totalFee: { amount: '100', currency: 'USDC' },
      destinationAmount: '0',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await expect(
      createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-4', BODY, d.options),
    ).rejects.toThrow('AMOUNT_TOO_LOW_AFTER_FEES');
  });

  it('fails soft (no deduction) when the fee currency cannot be priced into the send currency', async () => {
    // 'XAU' has no rate pair in the mock → resolveTransferFeeInSendCurrency
    // returns null → no deduction, marked unavailable, recipient gets the full
    // quoted amount (treasury absorbs rather than risk under-quoting).
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'odd_fee', amount: '5', currency: 'XAU' }],
      totalFee: { amount: '5', currency: 'XAU' },
      destinationAmount: '148500',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-5', BODY, d.options);
    expect((d.created.data!.destination as { amount: number }).amount).toBe(FIAT_GROSS);
    const fees = d.created.data!.fees as { transferFee?: { unavailable: boolean } };
    expect(fees.transferFee?.unavailable).toBe(true);
  });

  it('deducts a same-currency fee without a conversion lookup', async () => {
    // Fee already in the send currency (USDT) → no rate call needed; 3 USDT off.
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'Wire fee', amount: '3', currency: 'USDT' }],
      totalFee: { amount: '3', currency: 'USDT' },
      destinationAmount: '148500',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-6', BODY, d.options);
    // 99 − 3 = 96 USDT → 96 × 1500 = 144,000 NGN.
    expect((d.created.data!.destination as { amount: number }).amount).toBe(96 * 1500);
  });
});
