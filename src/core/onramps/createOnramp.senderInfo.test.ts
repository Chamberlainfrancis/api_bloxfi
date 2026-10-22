import { describe, it, expect, vi } from 'vitest';
import { applySenderInfoToDepositInfo, createOnramp } from '@/core/onramps/createOnramp';
import type {
  OnrampRepoCreate,
  UserRepoForOnramp,
  WalletRepoForOnramp,
  KybRepoForOnramp,
  CreateOnrampOptions,
} from '@/core/onramps/createOnramp';
import type { CreateOnrampRequest, DepositInfo } from '@/types/onramp';

const DEPOSIT_INFO: DepositInfo = {
  bankName: 'Kuda',
  beneficiary: { name: 'Palremit-LTD.', address: '', country: 'NG' },
  reference: 'ON-x',
  depositBy: new Date(Date.now() + 1e6).toISOString(),
  instruction: 'Deposit 1000 NGN to the account above using reference ON-x.',
};

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
      id: 'wal_1', address: 'TXyz...', memo: null, chain: 'TRC20', userId: 'user_1',
    })),
  };
  const kybRepo: KybRepoForOnramp = {
    getKybRailStatuses: vi.fn(async () => [{ rail: 'NGN', status: 'approved' }]),
  };
  const options: CreateOnrampOptions = {
    getQuoteFromPalremit: vi.fn(async () => ({
      conversionRate: '1450', conversion: 0.689, marketRate: '1460', rateCurrency: 'NGN', perCurrency: 'USDT',
    })),
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitFiatDeposit: vi.fn(async () => ({
      depositInfo: { ...DEPOSIT_INFO, beneficiary: { ...DEPOSIT_INFO.beneficiary } },
      providerRefs: { palremitOrchestrator: { provisionedAccountId: 'pa_1' } },
    })),
    convertToUsdc: (_: string, a: number) => Promise.resolve(a * 0.99),
  };
  return { onrampRepo, userRepo, walletRepo, kybRepo, options, created };
}

function body(transferType?: string): Omit<CreateOnrampRequest, 'requestId'> {
  return {
    source: { userId: 'user_1', currency: 'ngn', amount: 1000, ...(transferType ? { transferType } : {}) },
    destination: { userId: 'user_1', currency: 'usdt', chain: 'tron', externalWalletId: 'wal_1' },
    platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: '0xFee' },
  } as unknown as Omit<CreateOnrampRequest, 'requestId'>;
}

describe('applySenderInfoToDepositInfo', () => {
  it('replaces only the payee name', () => {
    const out = applySenderInfoToDepositInfo(DEPOSIT_INFO, { senderName: 'Palremit Deposits', settingId: 's1', source: 'ops_setting' });
    expect(out.beneficiary).toEqual({ name: 'Palremit Deposits', address: '', country: 'NG' });
    expect(out.bankName).toBe('Kuda');
    expect(out.instruction).toBe(DEPOSIT_INFO.instruction);
    expect(DEPOSIT_INFO.beneficiary.name).toBe('Palremit-LTD.');
  });

  it('returns the input unchanged without a setting', () => {
    expect(applySenderInfoToDepositInfo(DEPOSIT_INFO, null)).toBe(DEPOSIT_INFO);
  });
});

describe('createOnramp — ops sender info', () => {
  it('overrides the deposit payee name and records the setting on providerRefs', async () => {
    const d = makeDeps();
    const resolveSenderInfo = vi.fn(async () => ({ senderName: 'Palremit Deposits', settingId: 's1', source: 'ops_setting' as const }));
    const res = await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-1', body('Bank_Transfer'), {
      ...d.options,
      resolveSenderInfo,
    });
    expect(resolveSenderInfo).toHaveBeenCalledWith({ rampType: 'onramp', currency: 'ngn', rail: 'bank_transfer' });
    const persisted = d.created.data!;
    expect((persisted.depositInfo as DepositInfo).beneficiary.name).toBe('Palremit Deposits');
    expect((persisted.depositInfo as DepositInfo).bankName).toBe('Kuda');
    expect(persisted.providerRefs).toEqual({
      palremitOrchestrator: { provisionedAccountId: 'pa_1' },
      senderInfo: { senderName: 'Palremit Deposits', settingId: 's1', source: 'ops_setting' },
    });
    expect(res.transferDetails.depositInfo?.beneficiary.name).toBe('Palremit Deposits');
  });

  it('passes a null rail when the request has no transferType and leaves deposit details alone without a setting', async () => {
    const d = makeDeps();
    const resolveSenderInfo = vi.fn(async () => null);
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-2', body(), { ...d.options, resolveSenderInfo });
    expect(resolveSenderInfo).toHaveBeenCalledWith({ rampType: 'onramp', currency: 'ngn', rail: null });
    const persisted = d.created.data!;
    expect((persisted.depositInfo as DepositInfo).beneficiary.name).toBe('Palremit-LTD.');
    expect(persisted.providerRefs).toEqual({ palremitOrchestrator: { provisionedAccountId: 'pa_1' } });
  });

  it('behaves as before when no resolver is wired', async () => {
    const d = makeDeps();
    await createOnramp(d.onrampRepo, d.userRepo, d.walletRepo, d.kybRepo, 'ON-req-3', body(), d.options);
    expect((d.created.data!.depositInfo as DepositInfo).beneficiary.name).toBe('Palremit-LTD.');
  });
});
