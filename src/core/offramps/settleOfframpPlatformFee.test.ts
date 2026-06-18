import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as palremitLiquidity from '@/core/integrations/palremitLiquidity';
import * as palremitCoinNetworks from '@/core/integrations/palremitCoinNetworks';
import {
  settleOfframpPlatformFee,
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
    findOfframpById.mockImplementation(async (id: string) =>
      id === 'offramp-1' ? baseOfframp() : null
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
    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('skipped');
    expect(res.settlement?.status).toBe('skipped');
    expect(res.settlement?.notes?.some((n) => n.includes('network'))).toBe(true);
  });

  it('initiates Palremit withdrawal when config is valid', async () => {
    vi.spyOn(palremitCoinNetworks, 'fetchPalremitNetworksForCoin').mockResolvedValue([
      { code: 'MATIC', withdrawEnabled: true },
    ]);
    vi.spyOn(palremitCoinNetworks, 'resolvePalremitNetworkFromOptions').mockReturnValue('MATIC');
    vi.spyOn(palremitLiquidity, 'createPalremitWithdrawal').mockResolvedValue({
      id: 'wd-fee-1',
      client_reference: buildOfframpFeeClientReference(TXN_REF),
      state: 'processing',
      raw: {},
    });

    const res = await settleOfframpPlatformFee(repo, { liquidityRequest }, 'offramp-1');
    expect(res.outcome).toBe('processing');
    expect(res.settlement?.withdrawalId).toBe('wd-fee-1');
    expect(palremitLiquidity.createPalremitWithdrawal).toHaveBeenCalled();
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
});
