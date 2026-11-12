import { describe, it, expect, vi } from 'vitest';
import {
  businessDepositAccountsSchema,
  buildBusinessDepositInfo,
  resolveBusinessDepositAccount,
} from '@/core/onramps/businessDepositAccounts';
import { createOnrampPalremitFiatDeposit } from '@/core/integrations/palremitOnramp';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { createOnramp } from '@/core/onramps/createOnramp';
import type {
  OnrampRepoCreate,
  UserRepoForOnramp,
  WalletRepoForOnramp,
  KybRepoForOnramp,
  CreateOnrampOptions,
} from '@/core/onramps/createOnramp';
import type { CreateOnrampRequest, DepositInfo } from '@/types/onramp';

const SKYPAY_ACCOUNTS = {
  USD: {
    bankName: 'Community Federal Savings Bank',
    accountName: 'Canada Inc',
    accountNumber: '8335822014',
    bankCode: '026073008',
    bankAddress: '5 Penn Plaza, 14th Floor, New York City, NY, 10001, United States',
    country: 'US',
    firstPartyOnly: true,
  },
  CAD: {
    bankName: 'Digital Commerce Bank',
    accountName: 'Canada Inc',
    accountNumber: '942853029',
    bankCode: '035210009',
    bankAddress: '736 Meridian Road N.E, Calgary, Alberta, AB T2A 2N7, Canada',
    country: 'CA',
    firstPartyOnly: true,
  },
};

describe('businessDepositAccountsSchema', () => {
  it('accepts the Skypay USD and CAD accounts and upper-cases currency keys', () => {
    const parsed = businessDepositAccountsSchema.parse({ usd: SKYPAY_ACCOUNTS.USD, CAD: SKYPAY_ACCOUNTS.CAD });
    expect(Object.keys(parsed).sort()).toEqual(['CAD', 'USD']);
    expect(parsed.USD.accountNumber).toBe('8335822014');
  });

  it('rejects unknown fields and missing account numbers', () => {
    expect(businessDepositAccountsSchema.safeParse({ USD: { ...SKYPAY_ACCOUNTS.USD, foo: 1 } }).success).toBe(false);
    const { accountNumber: _drop, ...noNumber } = SKYPAY_ACCOUNTS.USD;
    expect(businessDepositAccountsSchema.safeParse({ USD: noNumber }).success).toBe(false);
    expect(businessDepositAccountsSchema.safeParse({ US: SKYPAY_ACCOUNTS.USD }).success).toBe(false);
  });
});

describe('resolveBusinessDepositAccount', () => {
  const meta = { onrampDepositAccounts: SKYPAY_ACCOUNTS };
  it('finds the account for the onramp currency, any casing', () => {
    expect(resolveBusinessDepositAccount(meta, 'usd')?.accountNumber).toBe('8335822014');
    expect(resolveBusinessDepositAccount(meta, 'CAD')?.accountNumber).toBe('942853029');
  });
  it('returns null for other currencies, no metadata, or a malformed entry', () => {
    expect(resolveBusinessDepositAccount(meta, 'NGN')).toBeNull();
    expect(resolveBusinessDepositAccount(null, 'USD')).toBeNull();
    expect(resolveBusinessDepositAccount({}, 'USD')).toBeNull();
    expect(resolveBusinessDepositAccount({ onrampDepositAccounts: { USD: { bankName: 'x' } } }, 'USD')).toBeNull();
  });
});

describe('buildBusinessDepositInfo', () => {
  it('shows the business account, the reference, and the 1st party only note', () => {
    const info = buildBusinessDepositInfo({
      account: businessDepositAccountsSchema.parse(SKYPAY_ACCOUNTS).CAD,
      currency: 'cad',
      amount: 2500,
      txnRef: 'ON-abc 123',
      depositByIso: '2026-11-13T12:00:00.000Z',
    });
    expect(info.bankName).toBe('Digital Commerce Bank');
    expect(info.beneficiary).toEqual({ name: 'Canada Inc', address: '', country: 'CA' });
    expect(info.wire).toEqual({ routingNumber: '035210009', accountNumber: '942853029' });
    expect(info.bankAddress).toContain('Calgary');
    expect(info.firstPartyOnly).toBe(true);
    expect(info.reference).toBe('ON-abc123');
    expect(info.instruction).toContain('2500 CAD');
    expect(info.instruction).toContain('1st party only');
  });
});

describe('createOnrampPalremitFiatDeposit with a business account', () => {
  it('returns the business account without calling the orchestrator, even for OwlPay/Graph USD', async () => {
    const request = vi.fn() as unknown as PalremitLiquidityRequestFn;
    const res = await createOnrampPalremitFiatDeposit(request, {
      firstName: 'A',
      lastName: 'B',
      email: 'a@example.com',
      currency: 'usd',
      amount: 1000,
      bloxRequestId: 'req-1',
      depositByIso: '2026-11-13T12:00:00.000Z',
      txnRef: 'ON-1',
      businessReference: 'user-skypay',
      useOwlPayUsd: true,
      useGraphUsd: true,
      businessDepositAccount: businessDepositAccountsSchema.parse(SKYPAY_ACCOUNTS).USD,
    });
    expect(request).not.toHaveBeenCalled();
    expect(res?.depositInfo.wire?.accountNumber).toBe('8335822014');
    expect((res?.providerRefs.palremitOrchestrator as Record<string, unknown>).mode).toBe('BUSINESS_STATIC');
  });
});

describe('createOnramp for a business with its own account', () => {
  function makeDeps(metadata: unknown) {
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
          receipt: null,
          fees: data.fees ?? null,
          failedReason: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      }),
    };
    const userRepo: UserRepoForOnramp = {
      findUserById: vi.fn(async () => ({
        id: 'user_1',
        businessInfo: { email: 'biz@example.com', legalName: 'Skypay' },
        legalRepresentative: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
        metadata,
      })),
    };
    const walletRepo: WalletRepoForOnramp = {
      findExternalWalletByIdAndUser: vi.fn(async () => ({
        id: 'wal_1', address: 'TXyz', memo: null, chain: 'TRC20', userId: 'user_1',
      })),
    };
    const kybRepo: KybRepoForOnramp = {
      getKybRailStatuses: vi.fn(async () => [{ rail: 'CAD', status: 'approved' }, { rail: 'USD', status: 'approved' }]),
    };
    // Business accounts go through the real function (which must not touch the
    // orchestrator); the normal path gets a canned provisioned account.
    const createPalremitFiatDeposit = vi.fn(async (p: Parameters<CreateOnrampOptions['createPalremitFiatDeposit']>[0]) =>
      p.businessDepositAccount
        ? createOnrampPalremitFiatDeposit(vi.fn() as unknown as PalremitLiquidityRequestFn, p)
        : {
            depositInfo: {
              bankName: 'Provisioned Bank',
              beneficiary: { name: 'Provisioned', address: '' },
              reference: 'ref',
              depositBy: p.depositByIso,
              instruction: 'x',
            },
            providerRefs: { palremitOrchestrator: { provisionedAccountId: 'pa_1' } },
          }
    );
    const options: CreateOnrampOptions = {
      getQuoteFromPalremit: vi.fn(async () => ({
        conversionRate: '1.4', conversion: 714.28, marketRate: '1.4', rateCurrency: 'CAD', perCurrency: 'USDT',
      })),
      resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
      createPalremitFiatDeposit,
      convertToUsdc: (_: string, a: number) => Promise.resolve(a),
      resolveSenderInfo: vi.fn(async () => ({ senderName: 'House Name', settingId: 's1', source: 'ops_setting' as const })),
    };
    return { onrampRepo, userRepo, walletRepo, kybRepo, options, created, createPalremitFiatDeposit };
  }

  const body = (currency: string) =>
    ({
      source: { userId: 'user_1', currency, amount: 1000 },
      destination: { userId: 'user_1', currency: 'usdt', chain: 'tron', externalWalletId: 'wal_1' },
      platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
    }) as unknown as Omit<CreateOnrampRequest, 'requestId'>;

  it('uses the CAD account, keeps the holder name, and gives a 24h window', async () => {
    const d = makeDeps({ onrampDepositAccounts: SKYPAY_ACCOUNTS });
    const before = Date.now();
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-1', body('cad'), d.options);
    const info = d.created.data!.depositInfo as DepositInfo;
    expect(info.bankName).toBe('Digital Commerce Bank');
    expect(info.beneficiary.name).toBe('Canada Inc');
    expect(d.options.resolveSenderInfo).not.toHaveBeenCalled();
    const windowMs = new Date(info.depositBy).getTime() - before;
    expect(windowMs).toBeGreaterThan(23.9 * 3600 * 1000);
  });

  it('does not use Graph/Dakota/OwlPay USD flags when the business has a USD account', async () => {
    const d = makeDeps({ onrampDepositAccounts: SKYPAY_ACCOUNTS, owlpayUsdDeposits: true, dakotaUsdNamedDeposits: true });
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-2', body('usd'), d.options);
    const p = d.createPalremitFiatDeposit.mock.calls[0][0];
    expect(p.useOwlPayUsd).toBeUndefined();
    expect(p.useDakotaUsd).toBeUndefined();
    expect(p.businessDepositAccount?.accountNumber).toBe('8335822014');
    expect((d.created.data!.depositInfo as DepositInfo).wire?.routingNumber).toBe('026073008');
  });

  it('leaves other businesses on the normal path', async () => {
    const d = makeDeps({});
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-3', body('cad'), d.options);
    expect(d.createPalremitFiatDeposit.mock.calls[0][0].businessDepositAccount).toBeUndefined();
    expect(d.options.resolveSenderInfo).toHaveBeenCalled();
  });
});
