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

function makeDeps() {
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
      id: 'user_1',
      businessInfo: { email: 'biz@example.com', legalName: 'Acme Ltd' },
      legalRepresentative: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
    })),
  };
  const walletRepo: WalletRepoForOnramp = {
    findExternalWalletByIdAndUser: vi.fn(async () => ({
      id: 'wal_1',
      address: 'TXyz...',
      memo: null,
      chain: 'TRC20',
      userId: 'user_1',
    })),
  };
  const kybRepo: KybRepoForOnramp = {
    getKybRailStatuses: vi.fn(async () => [{ rail: 'NGN', status: 'approved' }]),
  };
  const options: CreateOnrampOptions = {
    getQuoteFromPalremit: vi.fn(async () => ({
      conversionRate: '1450',
      conversion: 0.689,
      marketRate: '1460',
      rateCurrency: 'NGN',
      perCurrency: 'USDT',
    })),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitFiatDeposit: vi.fn(async () => ({
      depositInfo: {
        bankName: 'Bank',
        beneficiary: { name: 'Acme', address: '' },
        reference: 'ON-x',
        depositBy: new Date(Date.now() + 1e6).toISOString(),
        instruction: 'pay',
      },
      providerRefs: {},
    })),
    convertToUsdc: (_: string, a: number) => Promise.resolve(a * 0.99),
  };
  return { onrampRepo, userRepo, walletRepo, kybRepo, options, created };
}

function bodyDirect(): Omit<CreateOnrampRequest, 'requestId'> {
  return {
    source: { userId: 'user_1', currency: 'ngn', amount: 1000 },
    destination: { userId: 'user_1', currency: 'usdt', chain: 'tron', externalWalletId: 'wal_1' },
    platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
  } as unknown as Omit<CreateOnrampRequest, 'requestId'>;
}

describe('createOnramp — rate-spread profit', () => {
  it('persists rate-spread profit on a direct onramp create', async () => {
    const d = makeDeps();
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-profit', bodyDirect(), d.options);
    const persisted = d.created.data!;
    const profit = (persisted.profit as { currency: string; amountInCurrency: string; amountUsdc: string | null }) ?? null;
    expect(profit).not.toBeNull();
    // onramp: output is perCurrency (USDT) → divide. profit_usdt = amount/marketRate − amount/rate
    expect(profit.currency).toBe('usdt');
    expect(profit.amountUsdc).not.toBeNull();
  });
});

describe('createOnramp — deposit window', () => {
  it('gives GHS (static) 24h and USD 3h', async () => {
    const now = Date.now();
    const ghs = makeDeps();
    ghs.kybRepo.getKybRailStatuses = vi.fn(async () => [{ rail: 'GHS', status: 'approved' }]);
    await createOnramp(
      ghs.onrampRepo,
      ghs.userRepo,
      ghs.walletRepo,
      ghs.kybRepo,
      'ON-ghs-window',
      {
        source: { userId: 'user_1', currency: 'ghs', amount: 500 },
        destination: { userId: 'user_1', currency: 'usdt', chain: 'tron', externalWalletId: 'wal_1' },
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      } as Omit<CreateOnrampRequest, 'requestId'>,
      ghs.options
    );
    const ghsExp = new Date(
      (ghs.created.data!.quoteInformation as { expiresAt: string }).expiresAt
    ).getTime();
    expect(ghsExp - now).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 2000);
    expect(ghsExp - now).toBeLessThan(24 * 60 * 60 * 1000 + 5000);
    expect(ghs.options.createPalremitFiatDeposit).toHaveBeenCalledWith(
      expect.objectContaining({
        depositByIso: (ghs.created.data!.quoteInformation as { expiresAt: string }).expiresAt,
      })
    );

    const usd = makeDeps();
    usd.kybRepo.getKybRailStatuses = vi.fn(async () => [{ rail: 'USD', status: 'approved' }]);
    usd.options.getQuoteFromPalremit = vi.fn(async () => ({
      conversionRate: '1',
      conversion: 100,
    }));
    const usdNow = Date.now();
    await createOnramp(
      usd.onrampRepo,
      usd.userRepo,
      usd.walletRepo,
      usd.kybRepo,
      'ON-usd-window',
      {
        source: { userId: 'user_1', currency: 'usd', amount: 100 },
        destination: { userId: 'user_1', currency: 'usdt', chain: 'tron', externalWalletId: 'wal_1' },
        platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
      } as Omit<CreateOnrampRequest, 'requestId'>,
      usd.options
    );
    const usdExp = new Date(
      (usd.created.data!.quoteInformation as { expiresAt: string }).expiresAt
    ).getTime();
    expect(usdExp - usdNow).toBeGreaterThanOrEqual(180 * 60 * 1000 - 2000);
    expect(usdExp - usdNow).toBeLessThan(180 * 60 * 1000 + 5000);
  });
});
