import { describe, it, expect, vi } from 'vitest';
import { createOnramp } from '@/core/onramps/createOnramp';
import type {
  CreateOnrampOptions,
  KybRepoForOnramp,
  OnrampRepoCreate,
  UserRepoForOnramp,
  WalletRepoForOnramp,
} from '@/core/onramps/createOnramp';
import { OfframpLinkError, type LinkableOfframp } from '@/core/fiatToFiat/offrampLink';
import type { CreateOnrampRequest } from '@/types/onramp';
import type { OnrampQuoteSnapshot } from '@/types/quote';

const USER = '2902e329-424e-4cba-b07b-346ec74b7124';
const ADDRESS = 'TA4pjXofzbEKH3vzCyjtxAponCaSV2Piu1';
const REF = 'OFF-184dbea0aeb86b5b605ba95a';

const quote = {
  version: 1,
  fromCurrency: 'ngn',
  toCurrency: 'usdt',
  destinationChain: 'TRC20',
  clientDestinationChain: 'TRC20',
  sendAmount: 66330,
  receiveNet: 48.190932,
  flow: 'FIAT_TO_FIAT',
  platformFee: { type: 'PERCENTAGE', value: 0, walletAddress: 'TFee' },
  conversionRate: '1376.4',
  rateValidUntil: new Date(Date.now() + 3600e3).toISOString(),
  quoteInformation: { flow: 'FIAT_TO_FIAT', rate: '1376.4' },
  fees: {},
} as unknown as OnrampQuoteSnapshot;

function linkedOfframp(over: Partial<LinkableOfframp> = {}): LinkableOfframp {
  return {
    id: 'off-1',
    userId: USER,
    txnRef: REF,
    status: 'AWAITING_CRYPTO',
    source: { amount: 48.190932, currency: 'usdt', chain: 'TRC20' },
    depositInstructions: {
      amount: '48.190932',
      address: ADDRESS,
      network: 'TRC20',
      currency: 'USDT',
      depositBy: new Date(Date.now() + 26 * 3600e3).toISOString(),
    },
    rateInformation: { flow: 'FIAT_TO_FIAT' },
    timeline: {},
    ...over,
  };
}

function setup(off: LinkableOfframp | null = linkedOfframp()) {
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
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }),
  };
  const userRepo: UserRepoForOnramp = {
    findUserById: vi.fn(async () => ({
      id: USER,
      businessInfo: { email: 'ops@example.com', legalName: 'Test Corp' },
      legalRepresentative: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com' },
    })),
  };
  const walletRepo: WalletRepoForOnramp = {
    findExternalWalletByIdAndUser: vi.fn(async () => ({ id: 'wal_1', address: ADDRESS, memo: null, chain: 'TRC20', userId: USER })),
  };
  const kybRepo: KybRepoForOnramp = { getKybRailStatuses: vi.fn(async () => [{ rail: 'NGN', status: 'approved' }]) };
  const createPalremitFiatDeposit = vi.fn(async () => ({
    depositInfo: {
      bankName: 'Kuda',
      beneficiary: { name: 'Palremit-LTD.', address: '' },
      reference: '7006204760-999129',
      depositBy: new Date(Date.now() + 3600e3).toISOString(),
      instruction: 'pay',
      accountNumber: '7006204760',
      routingNumber: '999129',
    },
    providerRefs: {},
  }));
  const findLiveOnrampsForOfframp = vi.fn(async () => [] as Array<{ txnRef: string | null }>);
  const options: CreateOnrampOptions = {
    resolvePalremitNetwork: vi.fn(async () => 'TRC20'),
    createPalremitFiatDeposit,
    lockedQuote: quote,
    offrampLink: { findOfframpByTxnRef: vi.fn(async () => off), findLiveOnrampsForOfframp },
  };
  return { onrampRepo, userRepo, walletRepo, kybRepo, options, created, createPalremitFiatDeposit, findLiveOnrampsForOfframp };
}

function body(destination: Partial<CreateOnrampRequest['destination']>): Omit<CreateOnrampRequest, 'requestId'> {
  return {
    source: { userId: USER, currency: 'ngn', amount: 66330, transferType: 'bank_transfer' },
    destination: { userId: USER, currency: 'usdt', chain: 'TRC20', ...destination },
    platformFee: quote.platformFee,
  };
}

describe('createOnramp with destination.offrampId', () => {
  it("pays the offramp's deposit address without an external wallet", async () => {
    const s = setup();
    const res = await createOnramp(s.onrampRepo, s.userRepo, s.walletRepo, s.kybRepo, 'req-1', body({ offrampId: REF }), s.options);

    expect(s.walletRepo.findExternalWalletByIdAndUser).not.toHaveBeenCalled();
    const dest = s.created.data!.destination as Record<string, unknown>;
    expect(dest.walletAddress).toBe(ADDRESS);
    expect(dest.offrampId).toBe(REF);
    expect(dest).not.toHaveProperty('externalWalletId');
    expect(dest.amount).toBe(48.190932);
    const details = (res as unknown as { transferDetails: { destination: Record<string, unknown> } }).transferDetails;
    expect(details.destination.offrampId).toBe(REF);
  });

  it('accepts a matching externalWalletId alongside offrampId', async () => {
    const s = setup();
    await createOnramp(s.onrampRepo, s.userRepo, s.walletRepo, s.kybRepo, 'req-1', body({ offrampId: REF, externalWalletId: 'wal_1' }), s.options);
    const dest = s.created.data!.destination as Record<string, unknown>;
    expect(dest.externalWalletId).toBe('wal_1');
    expect(dest.offrampId).toBe(REF);
  });

  it('rejects a bad link before the fiat deposit account is created', async () => {
    const s = setup(linkedOfframp({ status: 'CRYPTO_CONFIRMED' }));
    await expect(
      createOnramp(s.onrampRepo, s.userRepo, s.walletRepo, s.kybRepo, 'req-1', body({ offrampId: REF }), s.options)
    ).rejects.toBeInstanceOf(OfframpLinkError);
    expect(s.createPalremitFiatDeposit).not.toHaveBeenCalled();
    expect(s.onrampRepo.createOnramp).not.toHaveBeenCalled();
  });

  it('rejects an offramp another onramp already funds', async () => {
    const s = setup();
    s.findLiveOnrampsForOfframp.mockResolvedValueOnce([{ txnRef: 'ON-earlier' }]);
    await expect(
      createOnramp(s.onrampRepo, s.userRepo, s.walletRepo, s.kybRepo, 'req-1', body({ offrampId: REF }), s.options)
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(s.createPalremitFiatDeposit).not.toHaveBeenCalled();
  });

  it('keeps today\'s behaviour when only externalWalletId is sent', async () => {
    const s = setup();
    await createOnramp(s.onrampRepo, s.userRepo, s.walletRepo, s.kybRepo, 'req-1', body({ externalWalletId: 'wal_1' }), s.options);
    expect(s.options.offrampLink!.findOfframpByTxnRef).not.toHaveBeenCalled();
    const dest = s.created.data!.destination as Record<string, unknown>;
    expect(dest.walletAddress).toBe(ADDRESS);
    expect(dest).not.toHaveProperty('offrampId');
  });
});
