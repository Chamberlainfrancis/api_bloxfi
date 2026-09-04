import { describe, expect, it, vi } from 'vitest';
import { reissueOfframpFiatPayout } from '@/core/offramps/reissueOfframpFiatPayout';

describe('reissueOfframpFiatPayout', () => {
  it('attaches the new Palremit payout id and retires the old one', async () => {
    const updateOfframpStatus = vi.fn().mockResolvedValue({});
    const offrampRepo = {
      findOfframpById: vi.fn().mockResolvedValue({
        id: 'off-1',
        txnRef: 'OFF-abc',
        status: 'COMPLETED',
        timeline: { fiatWithdrawalId: 'wd-old', fiatWithdrawalCompleted: true },
        providerRefs: {
          palremitOrchestrator: {
            palremitWithdrawalId: 'wd-old',
            withdrawalStatus: 'failed',
            markedManually: true,
          },
        },
      }),
      updateOfframpStatus,
    };
    const liquidityRequest = vi.fn().mockResolvedValue({
      status: 202,
      data: {
        id: 'wd-new',
        previous_id: 'wd-old',
        client_reference: 'OFF-abc',
        state: 'pending',
      },
    });

    const result = await reissueOfframpFiatPayout(offrampRepo, liquidityRequest, {
      offrampId: 'off-1',
      withdrawalId: 'wd-old',
    });

    expect(result).toEqual({
      status: 'reissued',
      withdrawalId: 'wd-new',
      previousWithdrawalId: 'wd-old',
      txnRef: 'OFF-abc',
    });
    expect(liquidityRequest).toHaveBeenCalledWith('/v1/withdrawals/wd-old/reissue', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'offramp-fiat-reissue:OFF-abc:wd-old' },
    });
    expect(updateOfframpStatus).toHaveBeenCalledWith(
      'off-1',
      'FIAT_PENDING',
      expect.objectContaining({
        lpReference: 'wd-new',
        timeline: expect.objectContaining({
          fiatWithdrawalId: 'wd-new',
          fiatWithdrawalCompleted: false,
        }),
        providerRefs: {
          palremitOrchestrator: expect.objectContaining({
            palremitWithdrawalId: 'wd-new',
            withdrawalStatus: 'pending',
            supersededWithdrawalIds: ['wd-old'],
          }),
        },
      }),
      { emitPartnerWebhook: false }
    );
  });

  it('rejects when the offramp is no longer attached to that payout', async () => {
    const result = await reissueOfframpFiatPayout(
      {
        findOfframpById: vi.fn().mockResolvedValue({
          id: 'off-1',
          txnRef: 'OFF-abc',
          status: 'FIAT_PENDING',
          timeline: { fiatWithdrawalId: 'wd-other' },
          providerRefs: {},
        }),
        updateOfframpStatus: vi.fn(),
      },
      vi.fn(),
      { offrampId: 'off-1', withdrawalId: 'wd-old' }
    );
    expect(result).toMatchObject({ status: 'rejected', code: 'PAYOUT_MISMATCH', statusCode: 409 });
  });
});
