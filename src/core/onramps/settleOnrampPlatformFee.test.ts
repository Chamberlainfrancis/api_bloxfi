import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as palremitLiquidity from '@/core/integrations/palremitLiquidity';
import * as palremitCoinNetworks from '@/core/integrations/palremitCoinNetworks';
import {
  applyOnrampPlatformFeeWithdrawalWebhook,
  queueOnrampPlatformFeeSettlement,
  settleOnrampPlatformFee,
} from '@/core/onramps/settleOnrampPlatformFee';

const TXN_REF = 'ON-635d8fecfbc6926c9333ad98';
const FEE_WALLET = '0x6067a74BCAf95c68610bBEd7f104726C627e7812';

function platformFee(settlement?: Record<string, unknown>) {
  return {
    type: 'PERCENTAGE',
    value: '0.0015',
    amount: '7.51138179',
    currency: 'usdc',
    walletAddress: FEE_WALLET,
    settlementCurrency: 'USDC',
    settlementNetwork: 'MATIC',
    ...(settlement ? { settlement } : {}),
  };
}

function baseOnramp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'onramp-1',
    status: 'COMPLETED',
    txnRef: TXN_REF,
    fees: { platformFee: platformFee() },
    ...overrides,
  };
}

function makeRepo() {
  return {
    findOnrampById: vi.fn(),
    findOnrampByTxnRef: vi.fn(),
    updateOnrampFees: vi.fn(async () => ({})),
  };
}

describe('queueOnrampPlatformFeeSettlement', () => {
  const liquidityRequest = vi.fn();
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = makeRepo();
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal');
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
  });

  it('queues a pending settlement on a completed onramp without sending anything', async () => {
    repo.findOnrampById.mockResolvedValue(baseOnramp());
    const res = await queueOnrampPlatformFeeSettlement(repo, { liquidityRequest }, 'onramp-1');
    expect(res.outcome).toBe('pending');
    expect(palremitLiquidity.createPalremitWithdrawal).not.toHaveBeenCalled();
    const fees = repo.updateOnrampFees.mock.calls[0]?.[1] as {
      platformFee?: { amount?: string; settlement?: { status?: string } };
    };
    expect(fees.platformFee?.settlement?.status).toBe('pending');
    expect(fees.platformFee?.amount).toBe('7.51138179');
  });

  it('does not queue an onramp that is not COMPLETED', async () => {
    repo.findOnrampById.mockResolvedValue(baseOnramp({ status: 'CRYPTO_PENDING' }));
    const res = await queueOnrampPlatformFeeSettlement(repo, { liquidityRequest }, 'onramp-1');
    expect(res.outcome).toBe('not_ready');
    expect(repo.updateOnrampFees).not.toHaveBeenCalled();
  });

  it('is idempotent once queued', async () => {
    repo.findOnrampById.mockResolvedValue(
      baseOnramp({ fees: { platformFee: platformFee({ status: 'pending' }) } })
    );
    const res = await queueOnrampPlatformFeeSettlement(repo, { liquidityRequest }, 'onramp-1');
    expect(res.outcome).toBe('already_queued');
    expect(repo.updateOnrampFees).not.toHaveBeenCalled();
  });
});

describe('settleOnrampPlatformFee', () => {
  const liquidityRequest = vi.fn();
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    vi.restoreAllMocks();
    repo = makeRepo();
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitLiquidity, 'getPalremitWithdrawalByClientReference').mockResolvedValue(null);
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal').mockResolvedValue({
      id: 'wd-on-fee-1',
      client_reference: `${TXN_REF}-FEE`,
      state: 'processing',
      raw: { id: 'wd-on-fee-1', client_reference: `${TXN_REF}-FEE`, state: 'processing' },
    });
  });

  it('does not send until the settlement is pending approval', async () => {
    repo.findOnrampById.mockResolvedValue(baseOnramp());
    const res = await settleOnrampPlatformFee(repo, { liquidityRequest }, 'onramp-1');
    expect(res.outcome).toBe('not_ready');
    expect(palremitLiquidity.createPalremitWithdrawal).not.toHaveBeenCalled();
  });

  it('sends the stored fee to the stored platform wallet with an onramp fee reference', async () => {
    repo.findOnrampById.mockResolvedValue(
      baseOnramp({ fees: { platformFee: platformFee({ status: 'pending' }) } })
    );
    const res = await settleOnrampPlatformFee(repo, { liquidityRequest }, 'onramp-1');
    expect(res.outcome).toBe('processing');
    expect(res.settlement?.withdrawalId).toBe('wd-on-fee-1');
    expect(palremitLiquidity.createPalremitWithdrawal).toHaveBeenCalledWith(
      liquidityRequest,
      {
        client_reference: `${TXN_REF}-FEE`,
        asset: 'USDC',
        amount: 7.51138179,
        destination_type: 'crypto_address',
        network: 'MATIC',
        destination: { address: FEE_WALLET },
      },
      `onramp-fee-settlement:${TXN_REF}`
    );
    const fees = repo.updateOnrampFees.mock.calls.at(-1)?.[1] as {
      platformFee?: { settlement?: { status?: string } };
    };
    expect(fees.platformFee?.settlement?.status).toBe('processing');
  });

  it('skips without sending when the platform wallet is missing', async () => {
    repo.findOnrampById.mockResolvedValue(
      baseOnramp({
        fees: { platformFee: { ...platformFee({ status: 'pending' }), walletAddress: '' } },
      })
    );
    const res = await settleOnrampPlatformFee(repo, { liquidityRequest }, 'onramp-1');
    expect(res.outcome).toBe('skipped');
    expect(palremitLiquidity.createPalremitWithdrawal).not.toHaveBeenCalled();
  });
});

describe('applyOnrampPlatformFeeWithdrawalWebhook', () => {
  it('marks a processing settlement completed with the transaction hash', async () => {
    const repo = makeRepo();
    repo.findOnrampByTxnRef.mockResolvedValue(
      baseOnramp({
        fees: { platformFee: platformFee({ status: 'processing', withdrawalId: 'wd-on-fee-1' }) },
      })
    );
    const ok = await applyOnrampPlatformFeeWithdrawalWebhook(
      repo,
      TXN_REF,
      { id: 'wd-on-fee-1', settlement_reference: '0xfeehash' },
      'completed'
    );
    expect(ok).toBe(true);
    const fees = repo.updateOnrampFees.mock.calls[0]?.[1] as {
      platformFee?: { settlement?: { status?: string; transactionHash?: string } };
    };
    expect(fees.platformFee?.settlement?.status).toBe('completed');
    expect(fees.platformFee?.settlement?.transactionHash).toBe('0xfeehash');
  });

  it('ignores a webhook for a different withdrawal id', async () => {
    const repo = makeRepo();
    repo.findOnrampByTxnRef.mockResolvedValue(
      baseOnramp({
        fees: { platformFee: platformFee({ status: 'processing', withdrawalId: 'wd-on-fee-1' }) },
      })
    );
    const ok = await applyOnrampPlatformFeeWithdrawalWebhook(
      repo,
      TXN_REF,
      { id: 'wd-other' },
      'completed'
    );
    expect(ok).toBe(false);
    expect(repo.updateOnrampFees).not.toHaveBeenCalled();
  });
});
