import { describe, it, expect, vi } from 'vitest';
import {
  acceptHeldPayoutRate,
  getHeldPayout,
  listHeldPayouts,
  type HeldPayoutDeps,
} from '@/core/admin/heldPayouts';

const OFFRAMP = {
  id: 'off-1',
  txnRef: 'OFF-abc',
  status: 'FIAT_PENDING',
  userId: 'u-1',
  source: {},
  destination: {},
  providerRefs: { palremitOrchestrator: { palremitWithdrawalId: 'wd-1' } },
};

function httpError(status: number, data: unknown): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status, statusCode: status, data });
}

function deps(request: HeldPayoutDeps['request']): HeldPayoutDeps & {
  recordAdminAction: ReturnType<typeof vi.fn>;
} {
  return {
    request,
    findOfframpById: vi.fn(async (id: string) => (id === 'off-1' ? OFFRAMP : null)),
    findOfframpByTxnRef: vi.fn(async (ref: string) => (ref === 'OFF-abc' ? OFFRAMP : null)),
    beneficiaryName: vi.fn(async () => 'Test Person'),
    recordAdminAction: vi.fn(async () => undefined),
  };
}

const HOLD = {
  reason: 'unfavorable_rate',
  tenant_actionable: true,
  held_since: '2026-10-08T16:05:28.000Z',
  source_amount_cap: '20863.486185',
  last_quoted_cost: '20864.297157',
};

describe('listHeldPayouts', () => {
  it('joins orchestrator holds to offramps by txnRef', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: [
          { id: 'wd-1', client_reference: 'OFF-abc', asset: 'GBP', amount: 15753.54, destination_type: 'wire', created_at: 'x', hold: HOLD },
          { id: 'wd-2', client_reference: 'OFF-unknown', asset: 'EUR', amount: 10, destination_type: 'wire', created_at: 'y', hold: { ...HOLD, reason: 'pending_review', tenant_actionable: false } },
        ],
      },
    });
    const items = await listHeldPayouts(deps(request));
    expect(request).toHaveBeenCalledWith('/v1/withdrawals/held', { method: 'GET' });
    expect(items[0]).toMatchObject({ offrampId: 'off-1', beneficiaryName: 'Test Person', payoutAmount: 15753.54, payoutCurrency: 'GBP' });
    expect(items[1]).toMatchObject({ offrampId: null, beneficiaryName: null });
  });
});

describe('getHeldPayout', () => {
  it('asks for a live quote on the offramp’s withdrawal', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { id: 'wd-1', hold: HOLD } });
    const r = await getHeldPayout(deps(request), 'off-1', { quote: true });
    expect(request).toHaveBeenCalledWith('/v1/withdrawals/wd-1/hold?quote=true', { method: 'GET' });
    expect(r.offrampId).toBe('off-1');
  });

  it('404s for an unknown offramp without calling Palremit', async () => {
    const request = vi.fn();
    await expect(getHeldPayout(deps(request), 'nope', { quote: false })).rejects.toMatchObject({ statusCode: 404 });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('acceptHeldPayoutRate', () => {
  const params = { offrampId: 'off-1', expectedCap: '20863.486185', newCap: '20870', actor: 'ops@x' };

  it('posts a deterministic idempotency key and records an admin action once released', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 202,
      data: { outcome: 'released', source_amount_cap: '20870.000000', previous_source_amount_cap: '20863.486185' },
    });
    const d = deps(request);
    const r = await acceptHeldPayoutRate(d, params);
    expect(request).toHaveBeenCalledWith('/v1/withdrawals/wd-1/accept-rate', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'accept-rate:wd-1:20863.486185:20870' },
      body: { expected_source_amount_cap: '20863.486185', new_source_amount_cap: '20870', accepted_by: 'ops@x' },
    });
    expect(r).toEqual({ outcome: 'released', sourceAmountCap: '20870.000000', previousSourceAmountCap: '20863.486185' });
    expect(d.recordAdminAction).toHaveBeenCalledTimes(1);
  });

  it('does not record a second admin action on replay', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { outcome: 'replay', source_amount_cap: '20870.000000', previous_source_amount_cap: '20863.486185' },
    });
    const d = deps(request);
    await acceptHeldPayoutRate(d, params);
    expect(d.recordAdminAction).not.toHaveBeenCalled();
  });

  it('rejects a lower limit before calling Palremit', async () => {
    const request = vi.fn();
    await expect(acceptHeldPayoutRate(deps(request), { ...params, newCap: '20863.48' })).rejects.toMatchObject({ statusCode: 400 });
    await expect(acceptHeldPayoutRate(deps(request), { ...params, newCap: '1.1234567' })).rejects.toMatchObject({ statusCode: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it('surfaces a cap race as 409 HOLD_CHANGED and records nothing', async () => {
    const request = vi.fn().mockRejectedValue(
      httpError(409, { error: 'withdrawal_hold_changed', message: 'source_amount_cap is now 20900.000000; re-read the hold and try again' })
    );
    const d = deps(request);
    await expect(acceptHeldPayoutRate(d, params)).rejects.toMatchObject({ statusCode: 409, code: 'HOLD_CHANGED' });
    expect(d.recordAdminAction).not.toHaveBeenCalled();
  });
});
