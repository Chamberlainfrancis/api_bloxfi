/**
 * Admin dashboard: offramp fiat payouts the orchestrator is deliberately
 * holding (GET /v1/withdrawals/held, /:id/hold) and the one hold BloxFi can
 * release itself — an unfavorable rate — by accepting a higher
 * source_amount_cap (POST /v1/withdrawals/:id/accept-rate).
 *
 * The orchestrator re-quotes on release and holds again if the cost has moved
 * past the new cap, so accepting never pays an unseen rate. Other holds
 * (pending review / operator attention) are Palremit ops decisions and are
 * only shown here.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { isHttpError } from '@/services/http';
import { extractPalremitErrorMessage } from '@/services/palremitErrorMessage';
import { AppError } from '@/types';
import { offrampFiatWithdrawalId } from '@/core/offramps/offrampFiatRetry';

export type HoldReason = 'unfavorable_rate' | 'pending_review' | 'operator_attention';

export interface WithdrawalHold {
  reason: HoldReason;
  tenant_actionable: boolean;
  held_since: string | null;
  source_amount_cap: string | null;
  last_quoted_cost: string | null;
}

export interface HeldWithdrawal {
  id: string;
  client_reference: string;
  asset: string;
  amount: number;
  destination_type: string;
  created_at: string;
  hold: WithdrawalHold;
}

export interface LiveQuote {
  cost: string | null;
  cap: string | null;
  exceeds_cap: boolean;
  overage: string | null;
  destination_amount: string | null;
  destination_asset: string;
  expires_at: string | null;
}

export interface WithdrawalHoldView {
  id: string;
  client_reference: string;
  state: string;
  hold: WithdrawalHold | null;
  live_quote: LiveQuote | null;
  live_quote_error: { kind: string; message: string } | null;
  max_source_amount_cap: string | null;
}

interface OfframpLike {
  id: string;
  txnRef: string | null;
  status: string;
  userId: string;
  source: unknown;
  destination: unknown;
  timeline?: unknown;
  providerRefs?: unknown;
}

export interface HeldPayoutDeps {
  request: PalremitLiquidityRequestFn;
  findOfframpById(id: string): Promise<OfframpLike | null>;
  findOfframpByTxnRef(txnRef: string): Promise<OfframpLike | null>;
  beneficiaryName(offramp: OfframpLike): Promise<string | null>;
  recordAdminAction(data: {
    txnId: string;
    status: string;
    note: string;
    actor: string | null;
  }): Promise<void>;
}

export interface HeldPayoutListItem {
  withdrawalId: string;
  txnRef: string;
  offrampId: string | null;
  offrampStatus: string | null;
  beneficiaryName: string | null;
  payoutAmount: number;
  payoutCurrency: string;
  createdAt: string;
  hold: WithdrawalHold;
}

function orchestratorError(e: unknown, fallback: string): AppError {
  if (isHttpError(e)) {
    const msg = extractPalremitErrorMessage(e.data) ?? fallback;
    const status = e.status === 409 ? 409 : e.status >= 400 && e.status < 500 ? 400 : 502;
    const code = e.status === 409 ? 'HOLD_CHANGED' : 'ORCHESTRATOR_REJECTED';
    return new AppError(msg, code, status);
  }
  return new AppError(fallback, 'ORCHESTRATOR_UNAVAILABLE', 502);
}

export async function listHeldPayouts(deps: HeldPayoutDeps): Promise<HeldPayoutListItem[]> {
  let res: { status: number; data: { data?: HeldWithdrawal[] } };
  try {
    res = await deps.request<{ data?: HeldWithdrawal[] }>('/v1/withdrawals/held', { method: 'GET' });
  } catch (e) {
    throw orchestratorError(e, 'Could not load held payouts from Palremit');
  }
  const rows = Array.isArray(res.data?.data) ? res.data.data : [];
  const items: HeldPayoutListItem[] = [];
  for (const w of rows) {
    const offramp = await deps.findOfframpByTxnRef(w.client_reference);
    items.push({
      withdrawalId: w.id,
      txnRef: w.client_reference,
      offrampId: offramp?.id ?? null,
      offrampStatus: offramp?.status ?? null,
      beneficiaryName: offramp ? await deps.beneficiaryName(offramp) : null,
      payoutAmount: w.amount,
      payoutCurrency: w.asset,
      createdAt: w.created_at,
      hold: w.hold,
    });
  }
  return items;
}

async function heldWithdrawalIdFor(deps: HeldPayoutDeps, offrampId: string): Promise<{
  offramp: OfframpLike;
  withdrawalId: string;
}> {
  const offramp = await deps.findOfframpById(offrampId);
  if (!offramp) throw new AppError('Offramp not found', 'NOT_FOUND', 404);
  const withdrawalId = offrampFiatWithdrawalId(offramp);
  if (!withdrawalId) {
    throw new AppError('This offramp has no Palremit payout yet', 'NO_PAYOUT', 400);
  }
  return { offramp, withdrawalId };
}

export async function getHeldPayout(
  deps: HeldPayoutDeps,
  offrampId: string,
  opts: { quote: boolean }
): Promise<WithdrawalHoldView & { offrampId: string }> {
  const { withdrawalId } = await heldWithdrawalIdFor(deps, offrampId);
  const path = `/v1/withdrawals/${encodeURIComponent(withdrawalId)}/hold${opts.quote ? '?quote=true' : ''}`;
  try {
    const res = await deps.request<WithdrawalHoldView>(path, { method: 'GET' });
    return { ...res.data, offrampId };
  } catch (e) {
    throw orchestratorError(e, 'Could not load the payout hold from Palremit');
  }
}

const CAP_RE = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/;

export interface AcceptHeldPayoutRateParams {
  offrampId: string;
  expectedCap: string;
  newCap: string;
  actor: string | null;
  note?: string;
}

export async function acceptHeldPayoutRate(
  deps: HeldPayoutDeps,
  params: AcceptHeldPayoutRateParams
): Promise<{ outcome: 'released' | 'replay'; sourceAmountCap: string; previousSourceAmountCap: string }> {
  const expectedCap = params.expectedCap.trim();
  const newCap = params.newCap.trim();
  if (!CAP_RE.test(expectedCap) || !CAP_RE.test(newCap) || !(Number(newCap) > 0)) {
    throw new AppError('Caps must be positive numbers with at most 6 decimals', 'INVALID_REQUEST', 400);
  }
  if (Number(newCap) < Number(expectedCap)) {
    throw new AppError('The new limit may not be lower than the current limit', 'INVALID_REQUEST', 400);
  }
  const { offramp, withdrawalId } = await heldWithdrawalIdFor(deps, params.offrampId);

  // Deterministic: a double-click or network retry of the same decision
  // collapses at the orchestrator instead of raising twice.
  const idempotencyKey = `accept-rate:${withdrawalId}:${expectedCap}:${newCap}`;
  const actor = params.actor?.trim() || 'bloxfi-admin-dashboard';
  let res: {
    status: number;
    data: { outcome: 'released' | 'replay'; source_amount_cap: string; previous_source_amount_cap: string };
  };
  try {
    res = await deps.request(`/v1/withdrawals/${encodeURIComponent(withdrawalId)}/accept-rate`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: {
        expected_source_amount_cap: expectedCap,
        new_source_amount_cap: newCap,
        accepted_by: actor,
        ...(params.note?.trim() ? { note: params.note.trim() } : {}),
      },
    });
  } catch (e) {
    throw orchestratorError(e, 'Palremit did not accept the new limit');
  }

  if (res.data.outcome === 'released') {
    await deps.recordAdminAction({
      txnId: offramp.id,
      status: offramp.status,
      note: `Accepted unfavorable rate: payout cost limit ${res.data.previous_source_amount_cap} → ${res.data.source_amount_cap} (withdrawal ${withdrawalId}); payout released for re-quote`,
      actor,
    });
  }
  return {
    outcome: res.data.outcome,
    sourceAmountCap: res.data.source_amount_cap,
    previousSourceAmountCap: res.data.previous_source_amount_cap,
  };
}
