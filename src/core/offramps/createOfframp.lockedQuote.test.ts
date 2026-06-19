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
import type { OfframpQuoteSnapshot } from '@/types/quote';

const VALID_PROVIDER_PAYOUT = {
  provider: 'palremit',
  schemaVersion: 2,
  corridor: { asset: 'usd', country: 'US', destinationType: 'local_bank', beneficiaryType: 'individual' },
  destination: { account_number: '0123456789', bank_code: '058' },
};

const LOCKED_QUOTE: OfframpQuoteSnapshot = {
  version: 1,
  fromCurrency: 'usdt',
  toCurrency: 'usd',
  fromChain: 'TRC20',
  clientFromChain: 'TRC20',
  sendAmount: 1000,
  corridor: { country: 'US', destinationType: 'local_bank', beneficiaryType: 'individual' },
  platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee' },
  baseConversionRate: '0.9984',
  conversionRate: '0.96903628624',
  inverseRate: '1.031957',
  rateValidUntil: new Date(Date.now() + 300000).toISOString(),
  destinationAmount: 969.04,
  quote: {
    sendGross: { amount: '1000', currency: 'usdt' },
    sendNet: { amount: '980.39', currency: 'usdt' },
    receiveGross: { amount: '998.40', currency: 'usd' },
    receiveNet: { amount: '969.04', currency: 'usd' },
    transferFee: { fees: [], total: null, unavailable: false },
  },
  fees: {
    platformFee: {
      type: 'PERCENTAGE',
      value: '0.01',
      amount: '9.78',
      currency: 'usd',
      walletAddress: '0xFee',
    },
  },
  rateInformation: {
    rate: '0.96903628624',
    conversionRate: '0.96903628624',
    inverseRate: '1.031957',
    fromCurrency: 'usdt',
    toCurrency: 'usd',
    fromChain: 'TRC20',
  },
};

function makeDeps() {
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
      currency: 'usd',
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
    getKybRailStatuses: vi.fn(async () => [{ rail: 'USD', status: 'approved' }]),
  };
  const options: CreateOfframpOptions = {
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitDeposit: vi.fn(async () => ({
      depositInstructions: {
        address: 'TDeposit...',
        amount: '1000',
        currency: 'USDT',
        network: 'TRC20',
        depositBy: LOCKED_QUOTE.rateValidUntil,
        instruction: 'send',
      },
      correlationId: 'OFF-x',
      providerRefs: {},
    })),
    lockedQuote: LOCKED_QUOTE,
  };
  return { offrampRepo, userRepo, accountRepo, walletRepo, kybRepo, options, created };
}

describe('createOfframp with lockedQuote', () => {
  it('uses snapshot pricing without calling getRateFromPalremit', async () => {
    const d = makeDeps();
    await createOfframp(
      d.offrampRepo,
      d.userRepo,
      d.accountRepo,
      d.walletRepo,
      d.kybRepo,
      'OFF-req-quote',
      {
        source: {
          userId: 'user_1',
          externalWalletId: 'wal_1',
          amount: 1000,
          currency: 'usdt',
          chain: 'TRC20',
        },
        destination: {
          userId: 'user_1',
          accountId: 'acc_1',
          currency: 'usd',
          amount: 969.04,
          purposeOfPayment: 'FAMILY_MAINTENANCE',
        },
        platformFee: LOCKED_QUOTE.platformFee,
        metadata: { isSelfTransfer: false },
      },
      d.options
    );

    expect((d.created.data!.destination as { amount: number }).amount).toBe(969.04);
    expect((d.created.data!.source as { amount: number }).amount).toBe(1000);
    const rate = d.created.data!.rateInformation as { conversionRate: string };
    expect(rate.conversionRate).toBe('0.96903628624');
  });
});
