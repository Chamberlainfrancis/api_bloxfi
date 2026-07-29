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

vi.mock('@/db/repositories/offramp.repo', () => ({
  findOfframpById: vi.fn(),
  updateOfframpStatus: vi.fn(),
}));

vi.mock('@/db/repositories/user.repo', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/db/repositories/account.repo', () => ({
  findOfframpAccountByIdAndUser: vi.fn(),
}));

import * as onrampRepo from '@/db/repositories/onramp.repo';
import * as adminActionRepo from '@/db/repositories/adminAction.repo';
import { advanceOnrampIfFiatProcessed } from '@/core/onramps/advanceOnrampPayout';
import { markOnrampFiatReceived } from '@/core/admin/dashboard';

describe('markOnrampFiatReceived', () => {
  const findOnrampById = vi.mocked(onrampRepo.findOnrampById);
  const updateOnrampStatus = vi.mocked(onrampRepo.updateOnrampStatus);
  const createAdminAction = vi.mocked(adminActionRepo.createAdminAction);
  const advance = vi.mocked(advanceOnrampIfFiatProcessed);

  beforeEach(() => {
    vi.clearAllMocks();
    advance.mockResolvedValue(undefined);
    createAdminAction.mockResolvedValue({
      id: 'aa1',
      txnType: 'onramp',
      txnId: 'on1',
      fromStatus: 'AWAITING_FUNDS',
      toStatus: 'FIAT_PROCESSED',
      note: null,
      actor: null,
      createdAt: new Date(),
    });
    // getTransactionDetail reloads the row after mark
    findOnrampById
      .mockResolvedValueOnce({
        id: 'on1',
        requestId: 'req1',
        userId: 'u1',
        status: 'AWAITING_FUNDS',
        txnRef: 'ONABC',
        source: { amount: 100, currency: 'GBP' },
        destination: {},
        providerRefs: { palremitOrchestrator: { providerName: 'static_fallback' } },
        depositInfo: {},
        quoteInformation: null,
        receipt: null,
        fees: null,
        profit: null,
        failedReason: null,
        lpReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never)
      .mockResolvedValue({
        id: 'on1',
        requestId: 'req1',
        userId: 'u1',
        status: 'FIAT_PROCESSED',
        txnRef: 'ONABC',
        source: { amount: 100, currency: 'GBP' },
        destination: {},
        providerRefs: {
          palremitOrchestrator: { providerName: 'static_fallback', depositStatus: 'credited' },
          manualFiatCredit: { code: 'BANK-1', reason: 'seen in Clear Bank' },
        },
        depositInfo: {},
        quoteInformation: null,
        receipt: { provider: 'manual_ops' },
        fees: null,
        profit: null,
        failedReason: null,
        lpReference: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never);
    updateOnrampStatus.mockResolvedValue({} as never);
  });

  it('requires reason and code', async () => {
    await expect(
      markOnrampFiatReceived({ id: 'on1', reason: ' ', code: 'X' })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' } satisfies Partial<AppError>);
    await expect(
      markOnrampFiatReceived({ id: 'on1', reason: 'ok', code: '  ' })
    ).rejects.toMatchObject({ code: 'INVALID_REQUEST' } satisfies Partial<AppError>);
  });

  it('marks AWAITING_FUNDS → FIAT_PROCESSED, audits, and advances payout', async () => {
    await markOnrampFiatReceived({
      id: 'on1',
      reason: 'Wire landed in Clear Bank',
      code: 'CLRB-991',
      actor: 'ops@palremit',
    });

    expect(updateOnrampStatus).toHaveBeenCalledWith(
      'on1',
      'FIAT_PROCESSED',
      expect.objectContaining({
        receipt: expect.objectContaining({
          provider: 'manual_ops',
          code: 'CLRB-991',
          reason: 'Wire landed in Clear Bank',
        }),
        providerRefs: expect.objectContaining({
          manualFiatCredit: expect.objectContaining({
            code: 'CLRB-991',
            reason: 'Wire landed in Clear Bank',
            actor: 'ops@palremit',
          }),
        }),
      })
    );
    expect(createAdminAction).toHaveBeenCalledWith({
      txnType: 'onramp',
      txnId: 'on1',
      fromStatus: 'AWAITING_FUNDS',
      toStatus: 'FIAT_PROCESSED',
      note: 'code=CLRB-991 | Wire landed in Clear Bank',
      actor: 'ops@palremit',
    });
    expect(advance).toHaveBeenCalledWith(
      expect.objectContaining({ findOnrampById: onrampRepo.findOnrampById }),
      'on1',
      expect.any(Function)
    );
  });

  it('rejects when status is not awaiting fiat', async () => {
    findOnrampById.mockReset();
    findOnrampById.mockResolvedValue({
      id: 'on1',
      status: 'COMPLETED',
      providerRefs: {},
    } as never);

    await expect(
      markOnrampFiatReceived({ id: 'on1', reason: 'late', code: 'X' })
    ).rejects.toMatchObject({ code: 'INVALID_STATE' } satisfies Partial<AppError>);
  });
});
