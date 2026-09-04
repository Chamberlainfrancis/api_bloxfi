/** Pure routing for dashboard fiat-payout retry. */

export type OfframpFiatRetryDecision =
  | { action: 'handoff' }
  | { action: 'reissue'; withdrawalId: string }
  | { action: 'already_initiated'; withdrawalId: string }
  | { action: 'reject'; code: string; message: string; statusCode: number };

export function offrampFiatWithdrawalId(row: {
  timeline?: unknown;
  providerRefs?: unknown;
}): string {
  const timeline =
    row.timeline != null && typeof row.timeline === 'object' && !Array.isArray(row.timeline)
      ? (row.timeline as Record<string, unknown>)
      : {};
  const refs =
    row.providerRefs != null && typeof row.providerRefs === 'object' && !Array.isArray(row.providerRefs)
      ? (row.providerRefs as Record<string, unknown>)
      : {};
  const orch =
    refs.palremitOrchestrator != null &&
    typeof refs.palremitOrchestrator === 'object' &&
    !Array.isArray(refs.palremitOrchestrator)
      ? (refs.palremitOrchestrator as Record<string, unknown>)
      : {};
  const fromTimeline =
    typeof timeline.fiatWithdrawalId === 'string' ? timeline.fiatWithdrawalId.trim() : '';
  const fromOrch =
    typeof orch.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId.trim() : '';
  return fromTimeline || fromOrch;
}

export function storedWithdrawalStatus(providerRefs: unknown): string {
  if (providerRefs == null || typeof providerRefs !== 'object' || Array.isArray(providerRefs)) {
    return '';
  }
  const orch = (providerRefs as Record<string, unknown>).palremitOrchestrator;
  if (orch == null || typeof orch !== 'object' || Array.isArray(orch)) return '';
  const ws = (orch as Record<string, unknown>).withdrawalStatus;
  return typeof ws === 'string' ? ws.trim().toLowerCase() : '';
}

/** Handoff retry: crypto confirmed, Palremit never accepted a payout. */
export function canRetryOfframpHandoff(row: {
  status: string;
  timeline?: unknown;
  providerRefs?: unknown;
}): boolean {
  if (row.status !== 'CRYPTO_CONFIRMED') return false;
  const timeline =
    row.timeline != null && typeof row.timeline === 'object' && !Array.isArray(row.timeline)
      ? (row.timeline as Record<string, unknown>)
      : {};
  if (timeline.fiatWithdrawalCompleted === true) return false;
  return !offrampFiatWithdrawalId(row);
}

const LP_IN_FLIGHT = new Set(['pending', 'processing']);
const LP_REISSUEABLE = new Set(['failed', 'refunded']);

function normalizeLpState(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

/** LP failed or refunded — operator may mint a new payout id. */
export function canReissueOfframpFiatPayout(params: {
  withdrawalId: string;
  lpState: string | null;
  storedWithdrawalStatus?: string;
}): boolean {
  if (!params.withdrawalId) return false;
  const live = normalizeLpState(params.lpState);
  if (LP_REISSUEABLE.has(live)) return true;
  if (live === 'successful' || LP_IN_FLIGHT.has(live)) return false;
  return LP_REISSUEABLE.has(normalizeLpState(params.storedWithdrawalStatus));
}

export function decideOfframpFiatRetry(params: {
  withdrawalId: string;
  lpState: string | null;
}): OfframpFiatRetryDecision {
  const wd = params.withdrawalId.trim();
  if (!wd) return { action: 'handoff' };

  const state = normalizeLpState(params.lpState);
  if (state === 'successful') {
    return {
      action: 'reject',
      code: 'PAYOUT_ALREADY_COMPLETED',
      message: 'Fiat payout is already successful at Palremit',
      statusCode: 409,
    };
  }
  if (LP_IN_FLIGHT.has(state)) {
    return {
      action: 'reject',
      code: 'PAYOUT_IN_PROGRESS',
      message: 'Fiat payout is still processing at Palremit and cannot be retried',
      statusCode: 409,
    };
  }
  if (LP_REISSUEABLE.has(state)) {
    return { action: 'reissue', withdrawalId: wd };
  }
  if (!state) {
    return {
      action: 'reject',
      code: 'PAYOUT_STATUS_UNKNOWN',
      message: 'Could not load the Palremit payout to decide retry vs reissue',
      statusCode: 422,
    };
  }
  return {
    action: 'reject',
    code: 'PAYOUT_NOT_RETRIABLE',
    message: `Palremit payout is ${state} and cannot be retried`,
    statusCode: 422,
  };
}
