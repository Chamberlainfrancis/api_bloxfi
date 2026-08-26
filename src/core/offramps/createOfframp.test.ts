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
import type { OfframpQuoteSnapshot } from '@/types/quote';

const VALID_PROVIDER_PAYOUT = {
  provider: 'palremit',
  schemaVersion: 2,
  corridor: { asset: 'NGN', country: 'NG', destinationType: 'local_bank', beneficiaryType: 'individual' },
  destination: { account_number: '0123456789', bank_code: '058' },
};

function snapshot(): OfframpQuoteSnapshot {
  return {
    version: 1,
    fromCurrency: 'usdt',
    toCurrency: 'ngn',
    fromChain: 'TRC20',
    clientFromChain: 'TRC20',
    sendAmount: 100,
    corridor: { country: 'NG', destinationType: 'local_bank', beneficiaryType: 'individual' },
    platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
    baseConversionRate: '1500',
    conversionRate: '1485.00000000000',
    inverseRate: '0.000673',
    rateValidUntil: new Date(Date.now() + 300000).toISOString(),
    destinationAmount: 148500,
    quote: {
      sendGross: { amount: '100', currency: 'usdt' },
      sendNet: { amount: '99.00000000', currency: 'usdt' },
      receiveGross: { amount: '150000.00', currency: 'ngn' },
      receiveNet: { amount: '148500.00', currency: 'ngn' },
      transferFee: { fees: [], total: null, unavailable: true },
    },
    fees: {
      platformFee: {
        type: 'PERCENTAGE',
        value: '0.01',
        amount: '1.00000000',
        currency: 'usdt',
        walletAddress: '0xFee',
        settlementCurrency: 'USDC',
        settlementNetwork: 'MATIC',
      },
      transferFee: { fees: [], total: null, unavailable: true },
    },
    rateInformation: {
      rate: '1485.00000000000',
      conversionRate: '1485.00000000000',
      inverseRate: '0.000673',
      fromCurrency: 'usdt',
      toCurrency: 'ngn',
      fromChain: 'TRC20',
      expiresAt: new Date(Date.now() + 300000).toISOString(),
    },
  };
}

function makeDeps() {
  const created: { data?: Parameters<OfframpRepoCreate['createOfframp']>[0] } = {};
  const offrampRepo: OfframpRepoCreate = {
    createOfframp: vi.fn(async (data) => {
      created.data = data;
      return {
        id: 'off_1', requestId: data.requestId, txnRef: data.txnRef, userId: data.userId,
        status: data.status, source: data.source, destination: data.destination,
        rateInformation: data.rateInformation, depositInstructions: data.depositInstructions ?? null,
        timeline: data.timeline ?? null, fees: data.fees ?? null, receipt: null,
        refundDetails: null, failedReason: null, lpReference: data.lpReference ?? null,
        createdAt: new Date('2026-06-11T00:00:00Z'), updatedAt: new Date('2026-06-11T00:00:00Z'),
      };
    }),
  };
  const userRepo: UserRepoForOfframp = {
    findUserById: vi.fn(async () => ({
      id: 'user_1', businessInfo: { email: 'biz@example.com', legalName: 'Acme Ltd' },
      legalRepresentative: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    })),
  };
  const accountRepo: AccountRepoForOfframp = {
    findOfframpAccountByIdAndUser: vi.fn(async () => ({
      id: 'acc_1', userId: 'user_1', currency: 'ngn', accountHolder: { name: 'Ada Lovelace' },
      providerPayout: VALID_PROVIDER_PAYOUT, paymentRail: 'local_bank', accountType: 'bank',
    })),
  };
  const walletRepo: WalletRepoForOfframp = {
    findExternalWalletByIdAndUser: vi.fn(async () => ({ id: 'wal_1', address: 'TXyz...', chain: 'TRC20', userId: 'user_1' })),
  };
  const kybRepo: KybRepoForOfframp = {
    getKybRailStatuses: vi.fn(async () => [{ rail: 'NGN', status: 'approved' }]),
  };
  const options: CreateOfframpOptions = {
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitDeposit: vi.fn(async () => ({
      depositInstructions: {
        address: 'TDeposit...', amount: '100', currency: 'USDT', network: 'TRC20',
        depositBy: new Date(Date.now() + 1e6).toISOString(), instruction: 'send',
      },
      correlationId: 'OFF-x', providerRefs: {},
    })),
    lockedQuote: snapshot(),
  };
  return { offrampRepo, userRepo, accountRepo, walletRepo, kybRepo, options, created };
}

function body(): Omit<CreateOfframpRequest, 'requestId'> {
  return {
    source: { userId: 'user_1', externalWalletId: 'wal_1', amount: 100, currency: 'usdt', chain: 'TRC20' },
    destination: { userId: 'user_1', accountId: 'acc_1', currency: 'ngn', amount: 148500, purposeOfPayment: 'family_support' },
    platformFee: { type: 'PERCENTAGE', value: 0.01, walletAddress: '0xFee', currency: 'USDC', network: 'MATIC' },
  } as Omit<CreateOfframpRequest, 'requestId'>;
}

describe('createOfframp — quote-first only', () => {
  it('persists fees and amounts from the locked quote snapshot', async () => {
    const d = makeDeps();
    await createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'req_1', body(), d.options);
    const persisted = d.created.data!;
    expect((persisted.fees as { platformFee: { currency: string; amount: string } }).platformFee.currency).toBe('usdt');
    expect((persisted.fees as { platformFee: { amount: string } }).platformFee.amount).toBe('1.00000000');
    expect((persisted.source as { amount: number }).amount).toBe(100);
    expect((persisted.destination as { amount: number }).amount).toBe(148500);
    expect(
      (persisted.providerRefs as { palremitOrchestrator: { sourceAmountCap: string } }).palremitOrchestrator
        .sourceAmountCap
    ).toBe('99.000000');
  });

  it('throws QUOTE_REQUIRED when no lockedQuote is supplied', async () => {
    const d = makeDeps();
    const opts = { ...d.options };
    delete (opts as Partial<CreateOfframpOptions>).lockedQuote;
    await expect(
      createOfframp(d.offrampRepo, d.userRepo, d.accountRepo, d.walletRepo, d.kybRepo, 'req_1', body(), opts)
    ).rejects.toThrow('QUOTE_REQUIRED');
  });
});
