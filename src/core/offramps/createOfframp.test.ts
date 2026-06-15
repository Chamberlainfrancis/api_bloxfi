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
import type { CreateOfframpRequest } from '@/types/offramp';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

const VALID_PROVIDER_PAYOUT = {
  provider: 'palremit',
  schemaVersion: 2,
  corridor: { asset: 'NGN', country: 'NG', destinationType: 'local_bank', beneficiaryType: 'individual' },
  destination: { account_number: '0123456789', bank_code: '058' },
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
    getRateFromPalremit: vi.fn(async () => ({
      fromCurrency: 'usdt',
      toCurrency: 'ngn',
      conversionRate: '1500',
      inverseRate: '0.000666',
      rateValidUntil: new Date(Date.now() + 300000).toISOString(),
      minimumAmount: '10',
      maximumAmount: '100000',
      estimatedProcessingTime: '1-3 business days',
      availableRails: [],
    })),
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

// Baseline: 100 USDT − 1% platform = 99 net crypto; 99 × 1500 = 148,500 NGN gross.
const FIAT_GROSS = 148500;

describe('createOfframp — Palremit payout fee deducted from receive', () => {
  it('deducts the provider fee from the receive and persists the itemized breakdown', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [
        { kind: 'network_fee', amount: '1800.00', currency: 'NGN' },
        { kind: 'conversion_fee', amount: '450.00', currency: 'NGN' },
      ],
      totalFee: { amount: '2250.00', currency: 'NGN' },
      destinationAmount: '148500',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-1', BODY, d.options);

    const persisted = d.created.data!;
    // Receive = gross − provider fee. Deposit (source.amount) is unchanged.
    expect((persisted.destination as { amount: number }).amount).toBe(FIAT_GROSS - 2250);
    expect((persisted.source as { amount: number }).amount).toBe(100);
    const fees = persisted.fees as { providerFee?: { fees: unknown[]; total: unknown; unavailable: boolean } };
    expect(fees.providerFee?.unavailable).toBe(false);
    expect(fees.providerFee?.total).toEqual({ amount: '2250.00', currency: 'NGN' });
    expect(fees.providerFee?.fees).toHaveLength(2);
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
    const fees = persisted.fees as { providerFee?: { unavailable: boolean } };
    expect(fees.providerFee?.unavailable).toBe(true);
  });

  it('does not deduct when the quote call fails entirely (null)', async () => {
    const d = makeDeps(null);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-3', BODY, d.options);
    expect((d.created.data!.destination as { amount: number }).amount).toBe(FIAT_GROSS);
  });

  it('throws AMOUNT_TOO_LOW_AFTER_FEES when the fee meets or exceeds the gross receive', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'network_fee', amount: '148500', currency: 'NGN' }],
      totalFee: { amount: '148500', currency: 'NGN' },
      destinationAmount: '0',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await expect(
      createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-4', BODY, d.options),
    ).rejects.toThrow('AMOUNT_TOO_LOW_AFTER_FEES');
  });

  it('ignores a fee quoted in a mismatched currency (no silent wrong deduction)', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'network_fee', amount: '5', currency: 'USD' }],
      totalFee: { amount: '5', currency: 'USD' }, // not NGN → must not be subtracted
      destinationAmount: '148500',
      effectiveRate: '1500',
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'OFF-req-5', BODY, d.options);
    expect((d.created.data!.destination as { amount: number }).amount).toBe(FIAT_GROSS);
    const fees = d.created.data!.fees as { providerFee?: { unavailable: boolean } };
    expect(fees.providerFee?.unavailable).toBe(true);
  });
});
