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
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

function makeDeps(feeQuote: PalremitWithdrawalFeeQuote | null | undefined) {
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
        developerFee: data.developerFee ?? null,
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
    getKybRailStatuses: vi.fn(async () => [{ rail: 'USD', status: 'approved' }]),
  };
  const options: CreateOnrampOptions = {
    // 100 USD → 100 USDT at rate 1.
    getQuoteFromPalremit: vi.fn(async () => ({ conversionRate: '1', conversion: 100 })),
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
    getProviderWithdrawalFeeQuote:
      feeQuote === undefined ? undefined : vi.fn(async () => feeQuote),
  };
  return { onrampRepo, userRepo, walletRepo, kybRepo, options, created };
}

// fee FIX 0 → no developer fee, so receive-after-dev = 100 USDT (isolates the provider fee).
const BODY: Omit<CreateOnrampRequest, 'requestId'> = {
  source: { userId: 'user_1', currency: 'usd', amount: 100 },
  destination: { userId: 'user_1', currency: 'usdt', chain: 'tron', externalWalletId: 'wal_1' },
  fee: { type: 'FIX', value: 0 },
} as unknown as Omit<CreateOnrampRequest, 'requestId'>;

function destAmount(data: NonNullable<ReturnType<typeof makeDeps>['created']['data']>): number {
  return (data.destination as { amount: number }).amount;
}

describe('createOnramp — Palremit crypto payout fee deducted from receive', () => {
  it('deducts the provider network fee from the receive and persists the breakdown', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'network_fee', amount: '2', currency: 'USDT' }],
      totalFee: { amount: '2', currency: 'USDT' },
      destinationAmount: '98',
      effectiveRate: null,
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-1', BODY, d.options);
    const data = d.created.data!;
    expect(destAmount(data)).toBe(98); // 100 − 2 network fee
    expect((data.source as { amount: number }).amount).toBe(100); // fiat send unchanged
    const qi = data.quoteInformation as { receiveNet: { amount: string }; transferFee?: { total: unknown; unavailable: boolean } };
    expect(qi.receiveNet.amount).toBe('98.00000000');
    expect(qi.transferFee?.unavailable).toBe(false);
    expect(qi.transferFee?.total).toEqual({ amount: '2', currency: 'USDT' });
  });

  it('does not deduct when the fee is unavailable (fail-soft)', async () => {
    const d = makeDeps({ feeUnavailable: true, fees: [], totalFee: null, destinationAmount: null, effectiveRate: null, expiresAt: null });
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-2', BODY, d.options);
    expect(destAmount(d.created.data!)).toBe(100);
    const qi = d.created.data!.quoteInformation as { transferFee?: { unavailable: boolean } };
    expect(qi.transferFee?.unavailable).toBe(true);
  });

  it('does not deduct when the quote call fails entirely (null)', async () => {
    const d = makeDeps(null);
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-3', BODY, d.options);
    expect(destAmount(d.created.data!)).toBe(100);
  });

  it('throws AMOUNT_TOO_LOW_AFTER_FEES when the fee meets or exceeds the receive', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'network_fee', amount: '100', currency: 'USDT' }],
      totalFee: { amount: '100', currency: 'USDT' },
      destinationAmount: '0',
      effectiveRate: null,
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await expect(
      createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-4', BODY, d.options),
    ).rejects.toThrow('AMOUNT_TOO_LOW_AFTER_FEES');
  });

  it('ignores a fee quoted in a mismatched currency', async () => {
    const quote: PalremitWithdrawalFeeQuote = {
      feeUnavailable: false,
      fees: [{ kind: 'network_fee', amount: '2', currency: 'USDC' }],
      totalFee: { amount: '2', currency: 'USDC' }, // not USDT → must not be subtracted
      destinationAmount: '98',
      effectiveRate: null,
      expiresAt: null,
    };
    const d = makeDeps(quote);
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-5', BODY, d.options);
    expect(destAmount(d.created.data!)).toBe(100);
    const qi = d.created.data!.quoteInformation as { transferFee?: { unavailable: boolean } };
    expect(qi.transferFee?.unavailable).toBe(true);
  });
});
