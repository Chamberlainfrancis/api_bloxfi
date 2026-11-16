import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  attemptIds,
  classifyWithdrawal,
  refundAuditNote,
  refundBlockReason,
  refundSignalFrom,
  storedProviderSignal,
  toRefundQueueRow,
  validateMarkRefunded,
  type PayoutAttempt,
} from '@/core/admin/offrampRefund';

const owlpayExpiredLive = {
  status: 'success',
  data: {
    id: 'wd-2',
    client_reference: 'OFF-5a38a68b',
    state: 'failed',
    failure_reason: { code: 'provider_expired', message: 'The payout expired before completion.' },
    state_history: [
      { from_state: null, to_state: 'accepted', cause: 'created', occurred_at: '2026-11-13T09:00:00.000Z' },
      { from_state: 'accepted', to_state: 'processing', cause: 'owlpay_transfer_created', occurred_at: '2026-11-13T09:00:05.000Z' },
      { from_state: 'processing', to_state: 'processing', cause: 'owlpay_funding_dispatched', occurred_at: '2026-11-13T09:01:00.000Z' },
      { from_state: 'processing', to_state: 'failed', cause: 'provider_failure', occurred_at: '2026-11-13T10:03:00.000Z' },
    ],
    created_at: '2026-11-13T09:00:00.000Z',
  },
};

function attempt(over: Partial<PayoutAttempt>): PayoutAttempt {
  return {
    withdrawalId: 'wd-1',
    current: true,
    outcome: 'expired',
    failureCode: 'provider_expired',
    funded: true,
    fundedAt: null,
    endedAt: '2026-11-13T10:03:00.000Z',
    createdAt: null,
    source: 'live',
    ...over,
  };
}

describe('classifyWithdrawal', () => {
  it('reads an OwlPay expiry after funding from the orchestrator tenant view', () => {
    const a = classifyWithdrawal(owlpayExpiredLive);
    expect(a).toMatchObject({
      withdrawalId: 'wd-2',
      outcome: 'expired',
      failureCode: 'provider_expired',
      funded: true,
      fundedAt: '2026-11-13T09:01:00.000Z',
      endedAt: '2026-11-13T10:03:00.000Z',
    });
  });

  it.each([
    ['provider_refunded', 'refunded'],
    ['provider_cancelled', 'cancelled'],
    ['provider_rejected', 'rejected'],
    ['temporarily_unavailable', 'failed'],
  ])('maps failure code %s to %s', (code, outcome) => {
    expect(classifyWithdrawal({ id: 'w', state: 'failed', failure_reason: { code } })?.outcome).toBe(outcome);
  });

  it('treats successful as paid and processing as in flight', () => {
    expect(classifyWithdrawal({ id: 'w', state: 'successful' })?.outcome).toBe('paid');
    expect(classifyWithdrawal({ id: 'w', state: 'processing' })?.outcome).toBe('processing');
  });

  it('reports funded=false when history exists without a funding step', () => {
    expect(
      classifyWithdrawal({
        id: 'w',
        state: 'failed',
        failure_reason: { code: 'provider_rejected' },
        state_history: [{ to_state: 'failed', cause: 'provider_failure', occurred_at: '2026-11-13T10:00:00Z' }],
      })?.funded
    ).toBe(false);
  });

  it('returns null without an id', () => {
    expect(classifyWithdrawal({ state: 'failed' })).toBeNull();
  });
});

describe('attemptIds', () => {
  it('lists the current attempt first, then reissued ones newest-first, without duplicates', () => {
    expect(
      attemptIds({
        providerRefs: { palremitOrchestrator: { palremitWithdrawalId: 'wd-3', supersededWithdrawalIds: ['wd-1', 'wd-2', 'wd-3'] } },
      })
    ).toEqual(['wd-3', 'wd-2', 'wd-1']);
  });

  it('falls back to timeline.fiatWithdrawalId', () => {
    expect(attemptIds({ providerRefs: {}, timeline: { fiatWithdrawalId: 'wd-9' } })).toEqual(['wd-9']);
  });
});

describe('refundSignalFrom', () => {
  it('raises a signal when the current attempt expired, counting every funded attempt', () => {
    const sig = refundSignalFrom([
      attempt({ withdrawalId: 'wd-2', current: true }),
      attempt({ withdrawalId: 'wd-1', current: false }),
    ]);
    expect(sig).toMatchObject({ outcome: 'expired', label: 'Expired at provider', withdrawalId: 'wd-2', fundedAttempts: 2 });
    expect(sig?.detail).toContain('2 times');
    expect(sig?.detail).toContain('Mark it refunded only once');
  });

  it('stays quiet when an earlier attempt expired but the reissue is in flight or paid', () => {
    expect(refundSignalFrom([attempt({ current: true, outcome: 'processing' }), attempt({ current: false })])).toBeNull();
    expect(refundSignalFrom([attempt({ current: true, outcome: 'paid' }), attempt({ current: false })])).toBeNull();
  });

  it('stays quiet when the provider could not be reached', () => {
    expect(refundSignalFrom([attempt({ source: 'unavailable', outcome: 'unknown' })])).toBeNull();
  });
});

describe('storedProviderSignal', () => {
  const fundedThenExpired = {
    status: 'COMPLETED',
    providerRefs: {
      palremitOrchestrator: {
        palremitWithdrawalId: 'wd-2',
        supersededWithdrawalIds: ['wd-1'],
        withdrawalStatus: 'failed_after_funding',
        rawWithdrawalFundedPayload: { withdrawal: { id: 'wd-2' } },
        rawWithdrawalFailedPayload: {
          withdrawal: { id: 'wd-2', state: 'failed', failure_reason: { code: 'provider_expired', message: 'x' } },
        },
      },
    },
  };

  it('reads the saved withdrawal.failed webhook for the current attempt', () => {
    expect(storedProviderSignal(fundedThenExpired)).toMatchObject({ outcome: 'expired', source: 'stored', fundedAttempts: 1 });
  });

  it('ignores a saved failure that belongs to an earlier, reissued attempt', () => {
    const reissued = {
      status: 'FIAT_PENDING',
      providerRefs: {
        palremitOrchestrator: {
          ...fundedThenExpired.providerRefs.palremitOrchestrator,
          palremitWithdrawalId: 'wd-3',
          supersededWithdrawalIds: ['wd-1', 'wd-2'],
          withdrawalStatus: 'pending',
        },
      },
    };
    expect(storedProviderSignal(reissued)).toBeNull();
  });

  it('is null once the offramp is REFUNDED', () => {
    expect(storedProviderSignal({ ...fundedThenExpired, status: 'REFUNDED' })).toBeNull();
  });
});

describe('refundBlockReason', () => {
  it('allows a completed offramp whose payout expired at the provider', () => {
    expect(refundBlockReason({ status: 'COMPLETED' }, attempt({}))).toBeNull();
  });

  it('blocks when already refunded', () => {
    expect(refundBlockReason({ status: 'REFUNDED' }, null)).toMatch(/already/);
  });

  it('blocks when no crypto arrived', () => {
    expect(refundBlockReason({ status: 'AWAITING_CRYPTO' }, null)).toMatch(/nothing to refund/);
    expect(refundBlockReason({ status: 'EXPIRED', timeline: {} }, null)).toMatch(/nothing to refund/);
  });

  it('allows an expired offramp that still received crypto', () => {
    expect(refundBlockReason({ status: 'EXPIRED', timeline: { cryptoReceivedAmount: '50' } }, null)).toBeNull();
  });

  it('blocks while the payout is in flight or after it was paid', () => {
    expect(refundBlockReason({ status: 'FIAT_PENDING' }, attempt({ outcome: 'processing' }))).toMatch(/in progress/);
    expect(refundBlockReason({ status: 'COMPLETED' }, attempt({ outcome: 'paid' }))).toMatch(/paid/);
  });

  it('does not block on an unreachable orchestrator (the server asks for acknowledgement instead)', () => {
    expect(refundBlockReason({ status: 'FAILED' }, attempt({ source: 'unavailable', outcome: 'unknown' }))).toBeNull();
  });
});

describe('validateMarkRefunded', () => {
  const base = { id: 'x', actor: 'Emmanuel', note: 'Sent back to partner wallet' };

  it('requires a name and a note', () => {
    expect(() => validateMarkRefunded({ ...base, actor: ' ' })).toThrow(/name/);
    expect(() => validateMarkRefunded({ ...base, note: '' })).toThrow(/note/);
  });

  it('normalises amount, currency and date', () => {
    const v = validateMarkRefunded({ ...base, amount: '1,100.18', currency: 'usdt', refundedAt: '2026-11-16T08:00:00Z' });
    expect(v).toMatchObject({ amount: '1100.18', currency: 'USDT', refundedAt: '2026-11-16T08:00:00.000Z' });
  });

  it('rejects bad amounts, hashes and future dates', () => {
    expect(() => validateMarkRefunded({ ...base, amount: '-5' })).toThrow(/positive/);
    expect(() => validateMarkRefunded({ ...base, transactionHash: 'bad hash!' })).toThrow(/hash/);
    expect(() => validateMarkRefunded({ ...base, refundedAt: '2999-01-01T00:00:00Z' })).toThrow(/future/);
  });
});

describe('refundAuditNote', () => {
  it('keeps the note and adds the money, tx and provider signal', () => {
    const note = refundAuditNote(
      { id: 'x', actor: 'E', note: 'Returned to partner', amount: '100.18', currency: 'USDT', transactionHash: '0xabc12345' },
      refundSignalFrom([attempt({})])
    );
    expect(note).toBe('Returned to partner · Refunded 100.18 USDT · Tx 0xabc12345 · Provider signal: expired at provider');
  });
});

describe('toRefundQueueRow', () => {
  it('surfaces who marked a refund for the recent list', () => {
    const r = toRefundQueueRow({
      id: 'id-1',
      txnRef: 'OFF-1',
      status: 'REFUNDED',
      source: { amount: 100.18, currency: 'USDT' },
      destination: { amount: 85, currency: 'EUR' },
      providerRefs: { manualRefund: { markedBy: 'Emmanuel' } },
      refundDetails: { refundedAt: '2026-11-16T08:00:00.000Z', amount: '100.18', currency: 'USDT' },
      updatedAt: new Date('2026-11-16T08:01:00.000Z'),
    });
    expect(r.refund).toMatchObject({ markedBy: 'Emmanuel', amount: '100.18' });
    expect(r.signal).toBeNull();
  });
});

// --- markOfframpRefunded (repos + orchestrator mocked) ----------------------

const repo = vi.hoisted(() => ({
  findOfframpById: vi.fn(),
  updateOfframpStatus: vi.fn(),
  createAdminAction: vi.fn(),
  getPalremitWithdrawalById: vi.fn(),
}));
vi.mock('@/db/repositories/offramp.repo', () => ({
  findOfframpById: repo.findOfframpById,
  updateOfframpStatus: repo.updateOfframpStatus,
}));
vi.mock('@/db/repositories/adminAction.repo', () => ({ createAdminAction: repo.createAdminAction }));
vi.mock('@/services/palremitAdapters', () => ({ createPalremitLiquidityAdapter: () => ({}) }));
vi.mock('@/core/integrations/palremitLiquidity', () => ({ getPalremitWithdrawalById: repo.getPalremitWithdrawalById }));

describe('markOfframpRefunded', () => {
  const row = {
    id: 'off-1',
    txnRef: 'OFF-5a38a68b',
    status: 'COMPLETED',
    source: { amount: 100.18, currency: 'usdt' },
    providerRefs: { palremitOrchestrator: { palremitWithdrawalId: 'wd-2', supersededWithdrawalIds: ['wd-1'] } },
    timeline: {},
  };

  beforeEach(() => {
    Object.values(repo).forEach((f) => f.mockReset());
  });

  it('sets REFUNDED with partner-safe refundDetails and records who did it', async () => {
    const { markOfframpRefunded } = await import('@/core/admin/offrampRefund');
    repo.findOfframpById.mockResolvedValue(row);
    repo.getPalremitWithdrawalById.mockImplementation(async (_a: unknown, id: string) => ({
      id,
      client_reference: 'OFF-5a38a68b',
      state: 'failed',
      raw: { data: { ...owlpayExpiredLive.data, id } },
    }));
    await markOfframpRefunded({ id: 'off-1', actor: 'Emmanuel', note: 'Returned to partner', transactionHash: '0xdeadbeef01' });

    const [id, status, updates, opts] = repo.updateOfframpStatus.mock.calls[0];
    expect(id).toBe('off-1');
    expect(status).toBe('REFUNDED');
    expect(opts).toEqual({ allowAfterFunds: true });
    expect(Object.keys(updates.refundDetails).sort()).toEqual(['currency', 'refundedAt', 'status', 'transactionHash']);
    expect(updates.refundDetails).toMatchObject({ status: 'refunded', currency: 'USDT', transactionHash: '0xdeadbeef01' });
    expect(updates.providerRefs.manualRefund).toMatchObject({
      markedBy: 'Emmanuel',
      note: 'Returned to partner',
      fromStatus: 'COMPLETED',
      verifiedLive: true,
      providerSignal: { outcome: 'expired', withdrawalId: 'wd-2', fundedAttempts: 2 },
    });
    expect(repo.createAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({ txnType: 'offramp', txnId: 'off-1', fromStatus: 'COMPLETED', toStatus: 'REFUNDED', actor: 'Emmanuel' })
    );
  });

  it('refuses while the provider still has the payout in flight', async () => {
    const { markOfframpRefunded } = await import('@/core/admin/offrampRefund');
    repo.findOfframpById.mockResolvedValue(row);
    repo.getPalremitWithdrawalById.mockResolvedValue({ id: 'wd-2', client_reference: 'x', state: 'processing', raw: { id: 'wd-2', state: 'processing' } });
    await expect(markOfframpRefunded({ id: 'off-1', actor: 'Emmanuel', note: 'test note' })).rejects.toMatchObject({ statusCode: 409 });
    expect(repo.updateOfframpStatus).not.toHaveBeenCalled();
  });

  it('asks for acknowledgement when the orchestrator cannot be reached', async () => {
    const { markOfframpRefunded } = await import('@/core/admin/offrampRefund');
    repo.findOfframpById.mockResolvedValue({ ...row, status: 'FAILED' });
    repo.getPalremitWithdrawalById.mockRejectedValue(new Error('down'));
    await expect(markOfframpRefunded({ id: 'off-1', actor: 'Emmanuel', note: 'test note' })).rejects.toMatchObject({
      code: 'REFUND_UNVERIFIED',
    });
    await markOfframpRefunded({ id: 'off-1', actor: 'Emmanuel', note: 'test note', acknowledgeUnverified: true });
    expect(repo.updateOfframpStatus).toHaveBeenCalledTimes(1);
    expect(repo.updateOfframpStatus.mock.calls[0][2].providerRefs.manualRefund.verifiedLive).toBe(false);
  });
});
