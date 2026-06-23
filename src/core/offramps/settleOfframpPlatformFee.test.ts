import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as palremitLiquidity from '@/core/integrations/palremitLiquidity';
import * as palremitCoinNetworks from '@/core/integrations/palremitCoinNetworks';
import {
  settleOfframpPlatformFee,
  queueOfframpPlatformFeeSettlement,
  applyOfframpPlatformFeeWithdrawalWebhook,
} from '@/core/offramps/settleOfframpPlatformFee';
import { buildOfframpFeeClientReference } from '@/utils/txnRef';

const TXN_REF = 'OFF-c4a18b6e3a71f02d4e5b9c08';

function baseOfframp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'offramp-1',
    status: 'COMPLETED',
    txnRef: TXN_REF,
    fees: {
      platformFee: {
        type: 'PERCENTAGE',
        value: '0.01',
        amount: '0.500000',
        currency: 'USDC',
        walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        settlementCurrency: 'USDC',
        settlementNetwork: 'MATIC',
      },
    },
    ...overrides,
  };
}

describe('queueOfframpPlatformFeeSettlement', () => {
  const updateOfframpStatus = vi.fn(async () => ({}));
  const findOfframpById = vi.fn();
  const findOfframpByTxnRef = vi.fn();
  const liquidityRequest = vi.fn();

  const repo = {
    findOfframpById,
    findOfframpByTxnRef,
    updateOfframpStatus,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal');
    findOfframpById.mockImplementation(async (id: string) =>
      id === 'offramp-1' ? baseOfframp() : null
    );
  });

  it('queues pending settlement when config is valid', async () => {
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitCoinNetworks, 'resolvePalremitNetworkFromOptions').mockReturnValue('MATIC');

    const res = await queueOfframpPlatformFeeSettlement(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('pending');
    expect(res.settlement?.status).toBe('pending');
    expect(palremitLiquidity.createPalremitWithdrawal).not.toHaveBeenCalled();
  });

  it('skips settlement and records notes when network is missing', async () => {
    findOfframpById.mockResolvedValue(
      baseOfframp({
        fees: {
          platformFee: {
            type: 'PERCENTAGE',
            value: '0.01',
            amount: '0.5',
            currency: 'USDC',
            walletAddress: '0xabc',
            settlementCurrency: 'USDC',
          },
        },
      })
    );
    const res = await queueOfframpPlatformFeeSettlement(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('skipped');
    expect(res.settlement?.status).toBe('skipped');
    expect(res.settlement?.notes?.some((n) => n.includes('network'))).toBe(true);
  });
});

describe('settleOfframpPlatformFee', () => {
  const updateOfframpStatus = vi.fn(async () => ({}));
  const findOfframpById = vi.fn();
  const findOfframpByTxnRef = vi.fn();
  const liquidityRequest = vi.fn();

  const repo = {
    findOfframpById,
    findOfframpByTxnRef,
    updateOfframpStatus,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal');
    vi.spyOn(palremitLiquidity, 'getPalremitWithdrawalByClientReference').mockResolvedValue(null);
    findOfframpById.mockImplementation(async (id: string) =>
      id === 'offramp-1'
        ? baseOfframp({
            fees: {
              platformFee: {
                type: 'PERCENTAGE',
                value: '0.01',
                amount: '0.500000',
                currency: 'USDC',
                walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
                settlementCurrency: 'USDC',
                settlementNetwork: 'MATIC',
                settlement: { status: 'pending', attemptedAt: '2026-06-19T00:00:00.000Z' },
              },
            },
          })
        : null
    );
    findOfframpByTxnRef.mockImplementation(async (ref: string) =>
      ref === TXN_REF ? baseOfframp() : null
    );
  });

  it('skips when offramp is not COMPLETED', async () => {
    findOfframpById.mockResolvedValue(baseOfframp({ status: 'FIAT_PENDING' }));
    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('not_ready');
    expect(updateOfframpStatus).not.toHaveBeenCalled();
  });

  it('does not initiate withdrawal until settlement is pending', async () => {
    findOfframpById.mockResolvedValue(baseOfframp());
    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('not_ready');
    expect(palremitLiquidity.createPalremitWithdrawal).not.toHaveBeenCalled();
  });

  it('initiates Palremit withdrawal when settlement is pending and config is valid', async () => {
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitCoinNetworks, 'resolvePalremitNetworkFromOptions').mockReturnValue('MATIC');
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal').mockResolvedValue({
      id: 'wd-fee-1',
      client_reference: buildOfframpFeeClientReference(TXN_REF),
      state: 'processing',
      raw: {
        id: 'wd-fee-1',
        client_reference: buildOfframpFeeClientReference(TXN_REF),
        state: 'processing',
      },
    });

    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('processing');
    expect(res.settlement?.withdrawalId).toBe('wd-fee-1');
    expect(palremitLiquidity.createPalremitWithdrawal).toHaveBeenCalled();
  });

  it('marks settlement completed when Palremit withdrawal already succeeded', async () => {
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitCoinNetworks, 'resolvePalremitNetworkFromOptions').mockReturnValue('MATIC');
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal').mockResolvedValue({
      id: 'wd-fee-1',
      client_reference: buildOfframpFeeClientReference(TXN_REF),
      state: 'pending',
      raw: {
        id: 'wd-fee-1',
        client_reference: buildOfframpFeeClientReference(TXN_REF),
        state: 'pending',
      },
    });
    vi.spyOn(palremitLiquidity, 'getPalremitWithdrawalByClientReference').mockResolvedValue({
      id: 'wd-fee-1',
      client_reference: buildOfframpFeeClientReference(TXN_REF),
      state: 'successful',
      raw: {
        id: 'wd-fee-1',
        client_reference: buildOfframpFeeClientReference(TXN_REF),
        state: 'successful',
        settlement_reference: '0xhash',
      },
    });

    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('already_settled');
    expect(res.settlement?.status).toBe('completed');
    expect(res.settlement?.transactionHash).toBe('0xhash');
  });

  it('retries Palremit withdrawal when settlement previously failed', async () => {
    findOfframpById.mockResolvedValue(
      baseOfframp({
        fees: {
          platformFee: {
            type: 'PERCENTAGE',
            value: '0.01',
            amount: '0.500000',
            currency: 'USDC',
            walletAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
            settlementCurrency: 'USDC',
            settlementNetwork: 'MATIC',
            settlement: {
              status: 'failed',
              attemptedAt: '2026-06-01T10:00:00.000Z',
              notes: ['Palremit withdrawal request failed'],
            },
          },
        },
      })
    );
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitCoinNetworks, 'resolvePalremitNetworkFromOptions').mockReturnValue('MATIC');
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal').mockResolvedValue({
      id: 'wd-fee-retry',
      client_reference: buildOfframpFeeClientReference(TXN_REF),
      state: 'processing',
      raw: {
        id: 'wd-fee-retry',
        client_reference: buildOfframpFeeClientReference(TXN_REF),
        state: 'processing',
      },
    });

    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('processing');
    const feesArg = updateOfframpStatus.mock.calls.at(-1)?.[2]?.fees as {
      platformFee?: { settlement?: { status?: string; notes?: string[] } };
    };
    expect(feesArg?.platformFee?.settlement?.status).toBe('processing');
    expect(feesArg?.platformFee?.settlement?.notes ?? []).toEqual([]);
  });
});

describe('settleOfframpPlatformFee — source-currency fee', () => {
  const updateOfframpStatus = vi.fn(async () => ({}));
  const findOfframpById = vi.fn();
  const findOfframpByTxnRef = vi.fn();
  const liquidityRequest = vi.fn();

  const repo = {
    findOfframpById,
    findOfframpByTxnRef,
    updateOfframpStatus,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(palremitLiquidity, 'getPalremitWithdrawalByClientReference').mockResolvedValue(null);
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitCoinNetworks, 'resolvePalremitNetworkFromOptions').mockReturnValue('MATIC');
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal').mockResolvedValue({
      id: 'wd-fee-src-1',
      client_reference: buildOfframpFeeClientReference(TXN_REF),
      state: 'processing',
      raw: {
        id: 'wd-fee-src-1',
        client_reference: buildOfframpFeeClientReference(TXN_REF),
        state: 'processing',
      },
    });
  });

  it('settles a USDC-source fee to USDC with no rate lookup', async () => {
    const getRate = vi.fn(async () => ({ conversionRate: '1' }));
    findOfframpById.mockResolvedValue(
      baseOfframp({
        fees: {
          platformFee: {
            type: 'PERCENTAGE',
            value: '0.01',
            amount: '10.00000000',
            currency: 'USDC',
            walletAddress: '0xFee',
            settlementCurrency: 'USDC',
            settlementNetwork: 'MATIC',
            settlement: { status: 'pending', attemptedAt: '2026-06-19T00:00:00.000Z' },
          },
        },
      })
    );

    const res = await settleOfframpPlatformFee(repo, { liquidityRequest, getRate }, 'offramp-1');
    expect(res.outcome).toBe('processing');
    expect(getRate).not.toHaveBeenCalled();
    expect(palremitLiquidity.createPalremitWithdrawal).toHaveBeenCalledWith(
      liquidityRequest,
      expect.objectContaining({ amount: 10 }),
      expect.any(String)
    );
  });

  it('converts a USDT-source fee to USDC via the rate', async () => {
    const getRate = vi.fn(async () => ({ conversionRate: '1' }));
    findOfframpById.mockResolvedValue(
      baseOfframp({
        fees: {
          platformFee: {
            type: 'PERCENTAGE',
            value: '0.01',
            amount: '10.00000000',
            currency: 'USDT',
            walletAddress: '0xFee',
            settlementCurrency: 'USDC',
            settlementNetwork: 'MATIC',
            settlement: { status: 'pending', attemptedAt: '2026-06-19T00:00:00.000Z' },
          },
        },
      })
    );

    const res = await settleOfframpPlatformFee(repo, { liquidityRequest, getRate }, 'offramp-1');
    expect(res.outcome).toBe('processing');
    expect(getRate).toHaveBeenCalledWith('USDT', 'USDC');
    expect(palremitLiquidity.createPalremitWithdrawal).toHaveBeenCalledWith(
      liquidityRequest,
      expect.objectContaining({ amount: 10 }),
      expect.any(String)
    );
  });
});

describe('applyOfframpPlatformFeeWithdrawalWebhook', () => {
  const updateOfframpStatus = vi.fn(async () => ({}));
  const findOfframpByTxnRef = vi.fn();
  const repo = {
    findOfframpById: vi.fn(),
    findOfframpByTxnRef,
    updateOfframpStatus,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    findOfframpByTxnRef.mockResolvedValue({
      id: 'offramp-1',
      status: 'COMPLETED',
      txnRef: TXN_REF,
      fees: {
        platformFee: {
          amount: '0.5',
          currency: 'USDC',
          walletAddress: '0xabc',
          settlement: {
            status: 'processing',
            withdrawalId: 'wd-fee-1',
          },
        },
      },
    });
  });

  it('marks settlement completed with transaction hash', async () => {
    const ok = await applyOfframpPlatformFeeWithdrawalWebhook(
      repo,
      TXN_REF,
      { id: 'wd-fee-1', settlement_reference: '0xhash' },
      'completed'
    );
    expect(ok).toBe(true);
    const feesArg = updateOfframpStatus.mock.calls[0]?.[2]?.fees as {
      platformFee?: { settlement?: { status?: string; transactionHash?: string } };
    };
    expect(feesArg?.platformFee?.settlement?.status).toBe('completed');
    expect(feesArg?.platformFee?.settlement?.transactionHash).toBe('0xhash');
  });

  it('reconciles a failed settlement row when Palremit later confirms success', async () => {
    findOfframpByTxnRef.mockResolvedValue({
      id: 'offramp-1',
      status: 'COMPLETED',
      txnRef: TXN_REF,
      fees: {
        platformFee: {
          amount: '0.5',
          currency: 'USDC',
          walletAddress: '0xabc',
          settlement: {
            status: 'failed',
            withdrawalId: 'wd-fee-1',
            notes: ['Palremit withdrawal request failed'],
          },
        },
      },
    });
    const ok = await applyOfframpPlatformFeeWithdrawalWebhook(
      repo,
      TXN_REF,
      { id: 'wd-fee-1', settlement_reference: '0xhash' },
      'completed'
    );
    expect(ok).toBe(true);
    const feesArg = updateOfframpStatus.mock.calls[0]?.[2]?.fees as {
      platformFee?: { settlement?: { status?: string } };
    };
    expect(feesArg?.platformFee?.settlement?.status).toBe('completed');
  });
});
