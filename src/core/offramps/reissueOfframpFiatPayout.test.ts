import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db/repositories/account.repo', () => ({
  findOfframpAccountByIdAndUser: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/db/repositories/user.repo', () => ({
  findUserById: vi.fn().mockResolvedValue(null),
}));

import { reissueOfframpFiatPayout } from '@/core/offramps/reissueOfframpFiatPayout';
import { findUserById } from '@/db/repositories/user.repo';

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
    expect(findUserById).not.toHaveBeenCalled();
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

  it('overlays the Bloxfi customer legal-rep DOB on Palremit reissue', async () => {
    vi.mocked(findUserById).mockResolvedValueOnce({
      legalRepresentative: { dateOfBirth: '1980-05-15' },
    } as never);
    const liquidityRequest = vi.fn().mockResolvedValue({
      status: 202,
      data: {
        id: 'wd-new',
        previous_id: 'wd-old',
        client_reference: 'OFF-abc',
        state: 'pending',
      },
    });

    const result = await reissueOfframpFiatPayout(
      {
        findOfframpById: vi.fn().mockResolvedValue({
          id: 'off-1',
          txnRef: 'OFF-abc',
          userId: 'ee15c7be-8364-4c59-a132-725d99141913',
          status: 'FAILED',
          destination: { accountId: 'be041b3e-234d-4ef8-af4a-7384ce3e64a6' },
          timeline: { fiatWithdrawalId: 'wd-old' },
          providerRefs: { palremitOrchestrator: { palremitWithdrawalId: 'wd-old' } },
        }),
        updateOfframpStatus: vi.fn().mockResolvedValue({}),
      },
      liquidityRequest,
      { offrampId: 'off-1', withdrawalId: 'wd-old' }
    );

    expect(result).toMatchObject({ status: 'reissued', withdrawalId: 'wd-new' });
    expect(liquidityRequest).toHaveBeenCalledWith('/v1/withdrawals/wd-old/reissue', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'offramp-fiat-reissue:OFF-abc:wd-old' },
      body: { destination: { beneficiary: { dob: '1980-05-15' } } },
    });
  });
});
