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
import { GraphOnrampKycError } from '@/core/integrations/graphOnrampKyc';
import { BRIANA_BUSINESS_REFERENCE } from '@/core/integrations/palremitOnramp';

const ACC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makeDeps(overrides?: {
  userId?: string;
  listOnrampAccounts?: CreateOnrampOptions['listOnrampAccounts'];
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
  const createPalremitFiatDeposit = vi.fn(async (p: { accountReference?: string }) => ({
    depositInfo: {
      bankName: 'Bank',
      beneficiary: { name: 'Holder', address: '' },
      reference: 'ON-x',
      depositBy: new Date(Date.now() + 1e6).toISOString(),
      instruction: 'pay',
      accountNumber: '123',
      routingNumber: '021000021',
    },
    providerRefs: { accountReference: p.accountReference },
  }));
  const options: CreateOnrampOptions = {
    getQuoteFromPalremit: vi.fn(async () => ({
      conversionRate: '1',
      conversion: 100,
      marketRate: '1',
      rateCurrency: 'USD',
      perCurrency: 'USDT',
    })),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitFiatDeposit,
    convertToUsdc: (_: string, a: number) => Promise.resolve(a),
    listOnrampAccounts: overrides?.listOnrampAccounts,
  };
  return { onrampRepo, userRepo, walletRepo, kybRepo, options, created, createPalremitFiatDeposit, userId };
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

function accountRow(id: string, email: string) {
  return {
    id,
    accountHolder: {
      type: 'individual' as const,
      name: 'End User',
      firstName: 'End',
      lastName: 'User',
      email,
      phone: '+15551234567',
      dateOfBirth: '1990-01-01',
      idType: 'passport',
      idNumber: 'P1',
      idCountry: 'US',
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
  };
}

describe('createOnramp — source.accountId', () => {
  it('resolves Graph USD via explicit Prisma Account.id when multiple accounts exist', async () => {
    const d = makeDeps({
      listOnrampAccounts: async () => [
        accountRow(ACC_A, 'a@example.com'),
        accountRow(ACC_B, 'b@example.com'),
      ],
    });

    await createOnramp(
      d.onrampRepo,
      d.userRepo,
      d.walletRepo,
      d.kybRepo,
      'ON-req-account-id',
      bodyUsd(d.userId, ACC_B),
      d.options
    );

    expect(d.createPalremitFiatDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        accountReference: ACC_B,
        useGraphUsd: true,
      })
    );
    expect(d.created.data?.source).toMatchObject({ accountId: ACC_B });
  });

  it('fails Graph USD without accountId when multiple accounts exist, without naming Graph', async () => {
    const d = makeDeps({
      listOnrampAccounts: async () => [
        accountRow(ACC_A, 'a@example.com'),
        accountRow(ACC_B, 'b@example.com'),
      ],
    });

    await expect(
      createOnramp(
        d.onrampRepo,
        d.userRepo,
        d.walletRepo,
        d.kybRepo,
        'ON-req-ambiguous',
        bodyUsd(d.userId),
        d.options
      )
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      const err = e as GraphOnrampKycError;
      expect(err.message).toContain('source.accountId');
      expect(err.message.toLowerCase()).not.toContain('graph');
      expect(err.message).not.toContain('GRAPH_ONRAMP');
      return true;
    });
  });

  it('rejects accountId that is not an onramp Account for the user', async () => {
    const d = makeDeps({
      listOnrampAccounts: async () => [accountRow(ACC_A, 'a@example.com')],
    });

    await expect(
      createOnramp(
        d.onrampRepo,
        d.userRepo,
        d.walletRepo,
        d.kybRepo,
        'ON-req-missing-acc',
        bodyUsd(d.userId, ACC_B),
        d.options
      )
    ).rejects.toThrow('ONRAMP_ACCOUNT_NOT_FOUND');
  });
});
