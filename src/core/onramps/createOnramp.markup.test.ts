import { describe, it, expect, vi } from 'vitest';
import { createOnramp } from '@/core/onramps/createOnramp';
import type {
  OnrampRepoCreate,
  UserRepoForOnramp,
  WalletRepoForOnramp,
  KybRepoForOnramp,
  CreateOnrampOptions,
} from '@/core/onramps/createOnramp';
import type { CreateOnrampRequest } from '@/types/onramp';
import type { OnrampQuoteSnapshot } from '@/types/quote';
import { BRIANA_BUSINESS_REFERENCE } from '@/core/integrations/palremitOnramp';

const ACC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeDeps(overrides?: {
  userId?: string;
  listOnrampAccounts?: CreateOnrampOptions['listOnrampAccounts'];
  lockedQuote?: OnrampQuoteSnapshot;
}) {
  const userId = overrides?.userId ?? BRIANA_BUSINESS_REFERENCE;
  const created: { data?: Parameters<OnrampRepoCreate['createOnramp']>[0] } = {};
  const onrampRepo: OnrampRepoCreate = {
    createOnramp: vi.fn(async (data) => {
      created.data = data;
      return {
        id: 'on_1',
        requestId: data.requestId,
        txnRef: data.txnRef,
        userId: data.userId,
        status: data.status,
        source: data.source,
        destination: data.destination,
        quoteInformation: data.quoteInformation,
        depositInfo: data.depositInfo ?? null,
        receipt: data.receipt ?? null,
        fees: data.fees ?? null,
        failedReason: null,
        createdAt: new Date('2026-06-11T00:00:00Z'),
        updatedAt: new Date('2026-06-11T00:00:00Z'),
      };
    }),
  };
  const userRepo: UserRepoForOnramp = {
    findUserById: vi.fn(async () => ({
      id: userId,
      businessInfo: { email: 'biz@example.com', legalName: 'Briana Payments' },
      legalRepresentative: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    })),
  };
  const walletRepo: WalletRepoForOnramp = {
    findExternalWalletByIdAndUser: vi.fn(async () => ({
      id: 'wal_1',
      address: 'TXyz...',
      memo: null,
      chain: 'TRC20',
      userId,
    })),
  };
  const kybRepo: KybRepoForOnramp = {
    getKybRailStatuses: vi.fn(async () => [{ rail: 'USD', status: 'approved' }]),
  };
  const getQuoteFromPalremit = vi.fn(async () => ({
    conversionRate: '1',
    conversion: 100,
    marketRate: '1',
    rateCurrency: 'USD',
    perCurrency: 'USDT',
  }));
  const options: CreateOnrampOptions = {
    getQuoteFromPalremit,
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitFiatDeposit: vi.fn(async () => ({
      depositInfo: {
        bankName: 'Bank',
        beneficiary: { name: 'Holder', address: '' },
        reference: 'ON-x',
        depositBy: new Date(Date.now() + 1e6).toISOString(),
        instruction: 'pay',
        accountNumber: '123',
        routingNumber: '021000021',
      },
      providerRefs: {},
    })),
    convertToUsdc: (_: string, a: number) => Promise.resolve(a),
    listOnrampAccounts: overrides?.listOnrampAccounts,
    ...(overrides?.lockedQuote ? { lockedQuote: overrides.lockedQuote } : {}),
  };
  return { onrampRepo, userRepo, walletRepo, kybRepo, options, created, getQuoteFromPalremit, userId };
}

function namedAccount(id: string) {
  return {
    id,
    currency: 'USD',
    railType: 'onramp',
    accountHolder: {
      type: 'individual' as const,
      name: 'End User',
      firstName: 'End',
      lastName: 'User',
      email: 'a@example.com',
      phone: '+15551234567',
      dateOfBirth: '1990-01-01',
      idType: 'passport',
      idNumber: 'P1',
      idCountry: 'US',
      taxId: '123-45-6789',
      address: {
        addressLine1: '1 Main',
        city: 'NYC',
        stateProvinceRegion: 'NY',
        postalCode: '10001',
        country: 'US',
      },
    },
    swipeluxCustomerId: null as string | null,
    sofQuestionnaire: {
      employmentStatus: 'employed',
      primaryPurpose: 'personal',
      sourceOfFunds: 'salary',
      expectedMonthlyPayments: '0_4999',
    },
    metadata: {
      documents: [{ type: 'passport', url: 'https://cdn.example.test/p.jpg' }],
    },
    providerIssuanceStatus: 'pending',
    provisionedAccountId: null,
    depositDetails: null,
  };
}

function bodyUsd(userId: string, accountId?: string): Omit<CreateOnrampRequest, 'requestId'> {
  return {
    source: {
      userId,
      currency: 'usd',
      amount: 100,
      ...(accountId ? { accountId } : {}),
    },
    destination: {
      userId,
      currency: 'usdt',
      chain: 'tron',
      externalWalletId: 'wal_1',
    },
    platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
  };
}

function unmarkedSnapshot(): OnrampQuoteSnapshot {
  return {
    version: 1,
    fromCurrency: 'usd',
    toCurrency: 'usdt',
    destinationChain: 'TRC20',
    clientDestinationChain: 'tron',
    sendAmount: 100,
    platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
    conversionRate: '1',
    rateValidUntil: new Date(Date.now() + 1e6).toISOString(),
    receiveNet: 100,
    quote: {
      sendGross: { amount: '100.00', currency: 'usd' },
      receiveGross: { amount: '100.00000000', currency: 'usdt' },
      baseReceiveNet: { amount: '100.00000000', currency: 'usdt' },
      receiveNet: { amount: '100.00000000', currency: 'usdt' },
      platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee', amount: '0.00000000' },
      transferFee: { fees: [], total: null, unavailable: true },
    },
    quoteInformation: {
      sendGross: { amount: '100.00', currency: 'usd' },
      sendNet: { amount: '100.00', currency: 'usd' },
      railFee: { amount: '0.00', currency: 'usd' },
      receiveGross: { amount: '100.00000000', currency: 'usdt' },
      receiveNet: { amount: '100.00000000', currency: 'usdt' },
      rate: '1',
      expiresAt: new Date(Date.now() + 1e6).toISOString(),
    },
    fees: {
      platformFee: {
        type: 'PERCENTAGE',
        value: '0',
        amount: '0.00000000',
        currency: 'usdt',
        walletAddress: '0xFee',
        settlementCurrency: 'USDC',
      },
    },
  };
}

function markedSnapshot(accountId: string): OnrampQuoteSnapshot {
  const conversion = 100 / 1.004;
  return {
    ...unmarkedSnapshot(),
    accountId,
    markup: { capability: 'usdNamedDeposit', currency: 'USD', markup: 0.004 },
    conversionRate: '1.004',
    marketRate: '1',
    rateCurrency: 'USD',
    perCurrency: 'USDT',
    receiveNet: conversion,
    quote: {
      ...unmarkedSnapshot().quote,
      receiveGross: { amount: conversion.toFixed(8), currency: 'usdt' },
      baseReceiveNet: { amount: conversion.toFixed(8), currency: 'usdt' },
      receiveNet: { amount: conversion.toFixed(8), currency: 'usdt' },
    },
    quoteInformation: {
      ...unmarkedSnapshot().quoteInformation,
      receiveGross: { amount: conversion.toFixed(8), currency: 'usdt' },
      receiveNet: { amount: conversion.toFixed(8), currency: 'usdt' },
      rate: '1.004',
    },
  };
}

describe('createOnramp — named USD markup', () => {
  it('applies 40 bps on direct create when the resolved Account is usdNamedDeposit', async () => {
    const d = makeDeps({
      listOnrampAccounts: async () => [namedAccount(ACC)],
    });
    await createOnramp(
      d.onrampRepo,
      d.userRepo,
      d.walletRepo,
      d.kybRepo,
      'ON-req-direct-markup',
      bodyUsd(d.userId, ACC),
      d.options
    );
    const qi = d.created.data!.quoteInformation as { rate: string; receiveGross: { amount: string } };
    expect(qi.rate).toBe('1.004');
    expect(Number(qi.receiveGross.amount)).toBeCloseTo(100 / 1.004, 6);
  });

  it('rejects a quoteId that was not quoted with accountId when create is named USD', async () => {
    const d = makeDeps({
      listOnrampAccounts: async () => [namedAccount(ACC)],
      lockedQuote: unmarkedSnapshot(),
    });
    await expect(
      createOnramp(
        d.onrampRepo,
        d.userRepo,
        d.walletRepo,
        d.kybRepo,
        'ON-req-quote-required',
        bodyUsd(d.userId, ACC),
        d.options
      )
    ).rejects.toThrow('QUOTE_ACCOUNT_REQUIRED');
    expect(d.onrampRepo.createOnramp).not.toHaveBeenCalled();
  });

  it('rejects when the quote accountId does not match create source.accountId', async () => {
    const d = makeDeps({
      listOnrampAccounts: async () => [namedAccount(ACC), namedAccount(ACC_B)],
      lockedQuote: markedSnapshot(ACC),
    });
    await expect(
      createOnramp(
        d.onrampRepo,
        d.userRepo,
        d.walletRepo,
        d.kybRepo,
        'ON-req-quote-mismatch',
        bodyUsd(d.userId, ACC_B),
        d.options
      )
    ).rejects.toThrow('QUOTE_ACCOUNT_MISMATCH');
  });

  it('uses the locked marked-up quote when accountIds match and does not re-fetch FX', async () => {
    const snap = markedSnapshot(ACC);
    const d = makeDeps({
      listOnrampAccounts: async () => [namedAccount(ACC)],
      lockedQuote: snap,
    });
    await createOnramp(
      d.onrampRepo,
      d.userRepo,
      d.walletRepo,
      d.kybRepo,
      'ON-req-locked-markup',
      bodyUsd(d.userId, ACC),
      d.options
    );
    expect(d.getQuoteFromPalremit).not.toHaveBeenCalled();
    const qi = d.created.data!.quoteInformation as { rate: string; receiveNet: { amount: string } };
    expect(qi.rate).toBe('1.004');
    expect(qi.receiveNet.amount).toBe(snap.quoteInformation.receiveNet.amount);
  });
});
