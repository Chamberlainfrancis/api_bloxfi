import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/types';

vi.mock('@/db/repositories/onramp.repo', () => ({
  findOnrampById: vi.fn(),
  updateOnrampStatus: vi.fn(),
}));

vi.mock('@/db/repositories/adminAction.repo', () => ({
  createAdminAction: vi.fn(),
  listAdminActionsForTxn: vi.fn().mockResolvedValue([]),
}));

vi.mock('@/core/ramps/depositExpiry', () => ({
  expireOnrampIfDepositPastDue: vi.fn().mockResolvedValue(null),
  expireOfframpIfDepositPastDue: vi.fn().mockResolvedValue(null),
  expireStaleOnramps: vi.fn(),
  expireStaleOfframps: vi.fn(),
}));

vi.mock('@/core/onramps/advanceOnrampPayout', () => ({
  advanceOnrampIfFiatProcessed: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/core/integrations', () => ({
  executePalremitOnrampCryptoWithdrawal: vi.fn(),
}));

vi.mock('@/services/palremitAdapters', () => ({
  createPalremitLiquidityAdapter: vi.fn(() => vi.fn()),
}));

vi.mock('@/core/fiatToFiat/settler', () => ({
  createFiatToFiatSettler: vi.fn(() => vi.fn().mockResolvedValue(false)),
}));

vi.mock('@/db/repositories/offramp.repo', () => ({
  findOfframpById: vi.fn(),
  updateOfframpStatus: vi.fn(),
  walletFundingOf: vi.fn((row: { source?: { fundingSource?: string } }) => (row.source?.fundingSource === "wallet" ? { userId: "u1" } : null)),
}));

vi.mock('@/db/repositories/user.repo', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/db/repositories/account.repo', () => ({
  findOfframpAccountByIdAndUser: vi.fn(),
}));

vi.mock('@/core/admin/offrampRefund', async (orig) => ({
  ...(await orig<typeof import('@/core/admin/offrampRefund')>()),
  markOfframpRefunded: vi.fn().mockResolvedValue({ id: 'off1', status: 'REFUNDED' }),
}));

import * as offrampRepo from '@/db/repositories/offramp.repo';
import { markOfframpRefunded } from '@/core/admin/offrampRefund';
import { markTransaction } from '@/core/admin/dashboard';

describe('mark failed on an offramp', () => {
  const find = vi.mocked(offrampRepo.findOfframpById);
  const update = vi.mocked(offrampRepo.updateOfframpStatus);
  const refund = vi.mocked(markOfframpRefunded);

  beforeEach(() => vi.clearAllMocks());

  it('refunds a wallet-funded offramp to the balance instead of leaving it FAILED', async () => {
    find.mockResolvedValue({ id: 'off1', userId: 'u1', status: 'FIAT_PENDING', source: { fundingSource: 'wallet' } } as never);
    await markTransaction({ type: 'offramp', id: 'off1', outcome: 'failed', note: 'bank rejected', actor: 'Ada' });
    expect(refund).toHaveBeenCalledWith({ id: 'off1', actor: 'Ada', note: 'bank rejected' });
    expect(update).not.toHaveBeenCalledWith('off1', 'FAILED', expect.anything(), expect.anything());
  });

  it('fills in actor and note when the operator leaves them out', async () => {
    find.mockResolvedValue({ id: 'off1', userId: 'u1', status: 'FIAT_PENDING', source: { fundingSource: 'wallet' } } as never);
    await markTransaction({ type: 'offramp', id: 'off1', outcome: 'failed' });
    expect(refund).toHaveBeenCalledWith(expect.objectContaining({ actor: 'dashboard', note: expect.stringContaining('wallet balance') }));
  });

  it('keeps marking deposit-funded offramps FAILED', async () => {
    find.mockResolvedValue({ id: 'off2', userId: 'u1', status: 'FIAT_PENDING', source: {} } as never);
    await markTransaction({ type: 'offramp', id: 'off2', outcome: 'failed' }).catch(() => undefined);
    expect(refund).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('off2', 'FAILED', expect.anything(), { allowAfterFunds: true });
  });
});
