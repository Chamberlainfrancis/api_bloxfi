/**
 * Offramp refunds on the admin dashboard.
 *
 * Two jobs:
 *  1. Read what the payout provider said about each payout attempt (OwlPay
 *     refunded / expired / cancelled / rejected), from the orchestrator's live
 *     withdrawal when we can reach it and from the stored webhook otherwise.
 *     This is a signal only: nothing here changes an offramp's status.
 *  2. Let an admin mark an offramp REFUNDED once the customer's money has
 *     actually gone back, with who / when / how recorded in the audit table.
 *
 * Pure helpers (classifyWithdrawal, storedProviderSignal, refundSignalFrom,
 * refundBlockReason) are DB-free so they can be unit-tested; repo and
 * orchestrator imports are lazy, as in dashboard.ts.
 */

import { AppError } from '@/types';
import { offrampFundsReceived } from '@/core/ramps/fundsReceivedGuard';

export type ProviderOutcome =
  | 'refunded'
  | 'expired'
  | 'cancelled'
  | 'rejected'
  | 'failed'
  | 'paid'
  | 'processing'
  | 'unknown';

/** Outcomes where the provider gave up on the payout and the beneficiary was not paid. */
const GAVE_UP: ReadonlySet<ProviderOutcome> = new Set(['refunded', 'expired', 'cancelled', 'rejected', 'failed']);

/** Orchestrator state_history cause written when USDC funding left for the provider. */
const FUNDING_CAUSES: ReadonlySet<string> = new Set(['owlpay_funding_dispatched']);

export interface PayoutAttempt {
  withdrawalId: string;
  /** The attempt the offramp currently points at (latest reissue). */
  current: boolean;
  outcome: ProviderOutcome;
  failureCode: string | null;
  /** USDC was sent to the provider for this attempt. null = we could not tell. */
  funded: boolean | null;
  fundedAt: string | null;
  endedAt: string | null;
  createdAt: string | null;
  /** live = read from the orchestrator just now; stored = last webhook we saved. */
  source: 'live' | 'stored' | 'unavailable';
}

export interface ProviderRefundSignal {
  outcome: Exclude<ProviderOutcome, 'paid' | 'processing' | 'unknown'>;
  /** Short label for chips, e.g. "Expired at provider". */
  label: string;
  /** One-sentence explanation for the detail view. */
  detail: string;
  withdrawalId: string | null;
  at: string | null;
  /** How many attempts were funded (USDC sent to the provider). */
  fundedAttempts: number;
  source: 'live' | 'stored';
}

function rec(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function outcomeFromFailureCode(code: string): ProviderOutcome {
  switch (code) {
    case 'provider_refunded':
      return 'refunded';
    case 'provider_expired':
      return 'expired';
    case 'provider_cancelled':
      return 'cancelled';
    case 'provider_rejected':
      return 'rejected';
    default:
      return 'failed';
  }
}

/**
 * Classify one orchestrator withdrawal (tenant GET /v1/withdrawals/:id body,
 * or the `withdrawal` object of a withdrawal.* webhook).
 */
export function classifyWithdrawal(raw: unknown): Omit<PayoutAttempt, 'current' | 'source'> | null {
  const top = rec(raw);
  const w = Object.keys(rec(top.data)).length ? rec(top.data) : top;
  const withdrawalId = str(w.id);
  if (!withdrawalId) return null;
  const state = str(w.state).toLowerCase();
  const failureCode = str(rec(w.failure_reason).code) || null;

  let outcome: ProviderOutcome = 'unknown';
  if (state === 'successful') outcome = 'paid';
  else if (state === 'failed') outcome = outcomeFromFailureCode(failureCode ?? '');
  else if (state === 'processing' || state === 'pending' || state === 'accepted') outcome = 'processing';

  const history = Array.isArray(w.state_history) ? w.state_history.map(rec) : null;
  let funded: boolean | null = null;
  let fundedAt: string | null = iso(w.funded_at);
  let endedAt: string | null = null;
  if (history) {
    const fundingEntry = history.find((h) => FUNDING_CAUSES.has(str(h.cause)));
    funded = !!fundingEntry || !!fundedAt;
    if (fundingEntry && !fundedAt) fundedAt = iso(fundingEntry.occurred_at);
    const terminal = [...history].reverse().find((h) => {
      const to = str(h.to_state).toLowerCase();
      return to === 'failed' || to === 'successful';
    });
    endedAt = terminal ? iso(terminal.occurred_at) : null;
  } else if (fundedAt) {
    funded = true;
  }
  if (!endedAt && (outcome === 'paid' || GAVE_UP.has(outcome))) {
    endedAt = iso(w.last_state_transition_at);
  }

  return { withdrawalId, outcome, failureCode, funded, fundedAt, endedAt, createdAt: iso(w.created_at) };
}

function orchRefs(providerRefs: unknown): Record<string, unknown> {
  return rec(rec(providerRefs).palremitOrchestrator);
}

/** Withdrawal ids for an offramp, current first, then earlier (superseded) attempts newest-first. */
export function attemptIds(row: { providerRefs?: unknown; timeline?: unknown; lpReference?: string | null }): string[] {
  const orch = orchRefs(row.providerRefs);
  const current = str(orch.palremitWithdrawalId) || str(rec(row.timeline).fiatWithdrawalId);
  const superseded = Array.isArray(orch.supersededWithdrawalIds)
    ? (orch.supersededWithdrawalIds as unknown[]).map(str).filter(Boolean).reverse()
    : [];
  const out: string[] = [];
  for (const id of [current, ...superseded]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Stored withdrawalStatus values that can only have been written after a failure webhook. */
const LATER_THAN_FAILED: ReadonlySet<string> = new Set(['successful', 'pending', 'processing', 'funded']);

/**
 * When an operator marked the offramp paid on the dashboard (Mark as success),
 * that time; otherwise null. A manual mark is how a payout retried or paid
 * outside the current orchestrator withdrawal is recorded, so the provider's
 * earlier rejection of that withdrawal no longer needs action.
 */
export function operatorPaidAt(row: { providerRefs?: unknown; timeline?: unknown }): string | null {
  const orch = orchRefs(row.providerRefs);
  if (orch.markedManually !== true || str(orch.withdrawalStatus).toLowerCase() !== 'successful') return null;
  return iso(orch.completedAt) ?? iso(rec(row.timeline).completedAt);
}

/** What we know about an attempt from webhooks already saved on the row (no network). */
export function storedAttempt(row: { providerRefs?: unknown }, withdrawalId: string): PayoutAttempt | null {
  const orch = orchRefs(row.providerRefs);
  const failed = classifyWithdrawal(rec(orch.rawWithdrawalFailedPayload).withdrawal);
  const fundedId = str(rec(rec(orch.rawWithdrawalFundedPayload).withdrawal).id);
  const isCurrent = str(orch.palremitWithdrawalId) === withdrawalId;
  // A webhook after the failure (same withdrawal retried at the orchestrator)
  // moves withdrawalStatus on; then the saved failure is history.
  const movedOn =
    isCurrent && orch.markedManually !== true && LATER_THAN_FAILED.has(str(orch.withdrawalStatus).toLowerCase());
  if (failed && failed.withdrawalId === withdrawalId && !movedOn) {
    const funded =
      failed.funded ?? (fundedId === withdrawalId || (isCurrent && str(orch.withdrawalStatus) === 'failed_after_funding') ? true : null);
    return { ...failed, funded, current: isCurrent, source: 'stored' };
  }
  if (isCurrent) {
    const ws = str(orch.withdrawalStatus).toLowerCase();
    const outcome: ProviderOutcome =
      ws === 'successful' ? 'paid' : ws === 'pending' || ws === 'processing' || ws === 'funded' ? 'processing' : 'unknown';
    return {
      withdrawalId,
      current: true,
      outcome,
      failureCode: null,
      funded: fundedId === withdrawalId || ws === 'funded' ? true : null,
      fundedAt: null,
      endedAt: null,
      createdAt: null,
      source: 'stored',
    };
  }
  return null;
}

const LABELS: Record<ProviderRefundSignal['outcome'], string> = {
  refunded: 'Refunded by provider',
  expired: 'Expired at provider',
  cancelled: 'Cancelled at provider',
  rejected: 'Rejected by provider',
  failed: 'Failed at provider',
};

function signalDetail(outcome: ProviderRefundSignal['outcome'], funded: boolean | null, fundedAttempts: number): string {
  const head =
    outcome === 'refunded'
      ? 'The provider says it refunded this payout, so the beneficiary was not paid.'
      : outcome === 'expired'
        ? 'The provider let this payout expire, so the beneficiary was not paid.'
        : outcome === 'cancelled'
          ? 'The provider cancelled this payout, so the beneficiary was not paid.'
          : outcome === 'rejected'
            ? 'The provider rejected this payout, so the beneficiary was not paid.'
            : 'The payout failed at the provider, so the beneficiary was not paid.';
  const money =
    fundedAttempts > 1
      ? ` USDC was sent to the provider ${fundedAttempts} times for this offramp; check that every one came back.`
      : funded
        ? ' USDC was sent to the provider for it; check that it came back.'
        : funded === false
          ? ' No USDC was sent to the provider for it.'
          : '';
  return head + money + ' Mark it refunded only once the customer has their money back.';
}

/**
 * The signal shown to ops. Only raised when the CURRENT attempt ended without
 * paying: an earlier expired attempt that was reissued and is now in flight or
 * paid is history, not something to refund. Nor when an operator marked the
 * offramp paid after the current attempt ended (retried or paid by hand).
 */
export function refundSignalFrom(
  attempts: PayoutAttempt[],
  opts: { operatorPaidAt?: string | null } = {}
): ProviderRefundSignal | null {
  const current = attempts.find((a) => a.current) ?? attempts[0];
  if (!current || current.source === 'unavailable') return null;
  if (!GAVE_UP.has(current.outcome)) return null;
  // Marked paid by an operator after this attempt ended: resolved, not a refund case.
  if (opts.operatorPaidAt && (!current.endedAt || opts.operatorPaidAt >= current.endedAt)) return null;
  const outcome = current.outcome as ProviderRefundSignal['outcome'];
  const fundedAttempts = attempts.filter((a) => a.funded === true).length;
  return {
    outcome,
    label: LABELS[outcome],
    detail: signalDetail(outcome, current.funded, fundedAttempts),
    withdrawalId: current.withdrawalId,
    at: current.endedAt,
    fundedAttempts,
    source: current.source === 'live' ? 'live' : 'stored',
  };
}

/** Signal from saved webhooks only (list views: no orchestrator calls per row). */
export function storedProviderSignal(row: { providerRefs?: unknown; timeline?: unknown; lpReference?: string | null; status?: string }): ProviderRefundSignal | null {
  if (row.status === 'REFUNDED') return null;
  const ids = attemptIds(row);
  const attempts = ids
    .map((id) => storedAttempt(row, id))
    .filter((a): a is PayoutAttempt => a != null);
  return refundSignalFrom(attempts, { operatorPaidAt: operatorPaidAt(row) });
}

const NOTHING_RECEIVED_STATUSES: ReadonlySet<string> = new Set(['CREATED', 'AWAITING_CRYPTO', 'EXPIRED']);

/**
 * Why this offramp cannot be marked refunded right now, or null when it can.
 * `current` is the live (or stored) state of the current payout attempt.
 */
export function refundBlockReason(
  row: { status: string; timeline?: unknown },
  current: PayoutAttempt | null
): string | null {
  if (row.status === 'REFUNDED') return 'This offramp is already marked refunded.';
  if (NOTHING_RECEIVED_STATUSES.has(row.status) && !offrampFundsReceived(row)) {
    return 'No crypto was received for this offramp, so there is nothing to refund.';
  }
  if (current && current.source !== 'unavailable') {
    if (current.outcome === 'paid') {
      return 'The provider reports this payout as paid to the beneficiary. A paid payout cannot be marked refunded.';
    }
    if (current.outcome === 'processing') {
      return 'The payout is still in progress at the provider. Wait until it fails, expires or is refunded, so the customer is not paid twice.';
    }
  }
  return null;
}

// --- orchestrator reads ----------------------------------------------------

const MAX_ATTEMPTS = 6;

/** Every payout attempt for the offramp, read live from the orchestrator, with stored fallback. */
export async function loadPayoutAttempts(row: {
  providerRefs?: unknown;
  timeline?: unknown;
  lpReference?: string | null;
}): Promise<PayoutAttempt[]> {
  const ids = attemptIds(row).slice(0, MAX_ATTEMPTS);
  if (!ids.length) return [];
  const [{ createPalremitLiquidityAdapter }, { getPalremitWithdrawalById }] = await Promise.all([
    import('@/services/palremitAdapters'),
    import('@/core/integrations/palremitLiquidity'),
  ]);
  const adapter = createPalremitLiquidityAdapter();
  return Promise.all(
    ids.map(async (id, i): Promise<PayoutAttempt> => {
      const current = i === 0;
      try {
        const live = await getPalremitWithdrawalById(adapter, id);
        const parsed = live ? classifyWithdrawal(live.raw) : null;
        if (parsed) {
          // The live tenant view has no funded_at; keep a funded flag we saw by webhook.
          const stored = storedAttempt(row, id);
          const funded = parsed.funded === true || stored?.funded === true ? true : parsed.funded;
          return { ...parsed, funded, current, source: 'live' };
        }
      } catch {
        // fall through to stored
      }
      const stored = storedAttempt(row, id);
      if (stored) return { ...stored, current };
      return {
        withdrawalId: id,
        current,
        outcome: 'unknown',
        failureCode: null,
        funded: null,
        fundedAt: null,
        endedAt: null,
        createdAt: null,
        source: 'unavailable',
      };
    })
  );
}

// --- mark refunded ---------------------------------------------------------

export interface MarkRefundedParams {
  id: string;
  actor: string;
  note: string;
  transactionHash?: string;
  amount?: string;
  currency?: string;
  refundedAt?: string;
  /** Required when the orchestrator could not be reached to confirm the payout is not in flight. */
  acknowledgeUnverified?: boolean;
}

const TX_HASH = /^[A-Za-z0-9:_-]{8,200}$/;

export function validateMarkRefunded(p: MarkRefundedParams): MarkRefundedParams {
  const actor = (p.actor ?? '').trim();
  const note = (p.note ?? '').trim();
  if (actor.length < 2) throw new AppError('Enter your name so the refund is recorded against you.', 'INVALID_REQUEST', 400);
  if (actor.length > 120) throw new AppError('Name is too long.', 'INVALID_REQUEST', 400);
  if (note.length < 3) throw new AppError('Add a note on how the customer was refunded.', 'INVALID_REQUEST', 400);
  if (note.length > 2000) throw new AppError('Note is too long (2,000 characters max).', 'INVALID_REQUEST', 400);
  const transactionHash = (p.transactionHash ?? '').trim() || undefined;
  if (transactionHash && !TX_HASH.test(transactionHash)) {
    throw new AppError('Refund transaction hash looks wrong.', 'INVALID_REQUEST', 400);
  }
  const amountRaw = (p.amount ?? '').trim().replace(/,/g, '');
  let amount: string | undefined;
  if (amountRaw) {
    const n = Number(amountRaw);
    if (!/^\d+(\.\d+)?$/.test(amountRaw) || !Number.isFinite(n) || n <= 0) {
      throw new AppError('Refund amount must be a positive number.', 'INVALID_REQUEST', 400);
    }
    amount = amountRaw;
  }
  const currency = (p.currency ?? '').trim().toUpperCase() || undefined;
  if (currency && !/^[A-Z0-9]{2,10}$/.test(currency)) {
    throw new AppError('Refund currency looks wrong.', 'INVALID_REQUEST', 400);
  }
  let refundedAt: string | undefined;
  if (p.refundedAt && p.refundedAt.trim()) {
    const d = new Date(p.refundedAt);
    if (Number.isNaN(d.getTime())) throw new AppError('Refund date is not a valid date.', 'INVALID_REQUEST', 400);
    if (d.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new AppError('Refund date cannot be in the future.', 'INVALID_REQUEST', 400);
    }
    refundedAt = d.toISOString();
  }
  return {
    id: p.id,
    actor,
    note,
    transactionHash,
    amount,
    currency,
    refundedAt,
    acknowledgeUnverified: p.acknowledgeUnverified === true,
  };
}

/** Text saved on the AdminAction row (internal only; never sent to partners). */
export function refundAuditNote(p: MarkRefundedParams, signal: ProviderRefundSignal | null): string {
  const parts = [p.note];
  const money = p.amount ? `${p.amount}${p.currency ? ` ${p.currency}` : ''}` : null;
  if (money) parts.push(`Refunded ${money}`);
  if (p.transactionHash) parts.push(`Tx ${p.transactionHash}`);
  if (p.refundedAt) parts.push(`Refunded at ${p.refundedAt}`);
  parts.push(signal ? `Provider signal: ${signal.label.toLowerCase()}` : 'No provider refund signal at the time');
  return parts.join(' · ');
}

/**
 * Mark the offramp REFUNDED. Re-checks the live payout state on the server so
 * a stale page cannot refund a payout that is in flight or paid.
 */
export async function markOfframpRefunded(input: MarkRefundedParams): Promise<{ id: string; status: string }> {
  const p = validateMarkRefunded(input);
  const [offrampRepo, adminActionRepo] = await Promise.all([
    import('@/db/repositories/offramp.repo'),
    import('@/db/repositories/adminAction.repo'),
  ]);
  const row = await offrampRepo.findOfframpById(p.id);
  if (!row) throw new AppError('Offramp not found', 'NOT_FOUND', 404);

  const attempts = await loadPayoutAttempts(row);
  const current = attempts.find((a) => a.current) ?? null;
  const blocked = refundBlockReason(row, current);
  if (blocked) throw new AppError(blocked, 'REFUND_NOT_ALLOWED', 409);
  if (current && current.source !== 'live' && !p.acknowledgeUnverified) {
    throw new AppError(
      'Could not confirm the payout status with the orchestrator. Tick "I checked the payout is not in flight" to continue.',
      'REFUND_UNVERIFIED',
      409
    );
  }

  const signal = refundSignalFrom(attempts);
  const source = rec(row.source);
  const now = new Date().toISOString();
  const refundedAt = p.refundedAt ?? now;
  const currency = p.currency ?? (str(source.currency).toUpperCase() || undefined);

  // refundDetails is partner-facing (GET /offramps); keep it to the public
  // RefundDetails shape. Who / note stay internal (providerRefs + AdminAction).
  const refundDetails = {
    status: 'refunded',
    refundedAt,
    ...(p.amount ? { amount: p.amount } : {}),
    ...(currency ? { currency } : {}),
    ...(p.transactionHash ? { transactionHash: p.transactionHash } : {}),
  };

  const fromStatus = row.status;
  await offrampRepo.updateOfframpStatus(
    row.id,
    'REFUNDED',
    {
      refundDetails,
      providerRefs: {
        manualRefund: {
          markedBy: p.actor,
          markedAt: now,
          refundedAt,
          note: p.note,
          ...(p.transactionHash ? { transactionHash: p.transactionHash } : {}),
          ...(p.amount ? { amount: p.amount } : {}),
          ...(currency ? { currency } : {}),
          fromStatus,
          providerSignal: signal
            ? { outcome: signal.outcome, withdrawalId: signal.withdrawalId, at: signal.at, fundedAttempts: signal.fundedAttempts }
            : null,
          verifiedLive: current?.source === 'live',
        },
      },
    },
    { allowAfterFunds: true }
  );

  await adminActionRepo.createAdminAction({
    txnType: 'offramp',
    txnId: row.id,
    fromStatus,
    toStatus: 'REFUNDED',
    note: refundAuditNote({ ...p, currency }, signal),
    actor: p.actor,
  });

  return { id: row.id, status: 'REFUNDED' };
}

// --- refunds queue ---------------------------------------------------------

export interface RefundQueueRow {
  id: string;
  txnRef: string | null;
  status: string;
  amount: number | null;
  currency: string | null;
  payoutAmount: number | null;
  payoutCurrency: string | null;
  signal: ProviderRefundSignal | null;
  refund: { refundedAt: string | null; markedBy: string | null; transactionHash: string | null; amount: string | null; currency: string | null } | null;
  updatedAt: string;
}

export function toRefundQueueRow(row: {
  id: string;
  txnRef: string | null;
  status: string;
  source: unknown;
  destination: unknown;
  providerRefs: unknown;
  timeline?: unknown;
  lpReference?: string | null;
  refundDetails?: unknown;
  updatedAt: Date;
}): RefundQueueRow {
  const s = rec(row.source);
  const d = rec(row.destination);
  const manual = rec(rec(row.providerRefs).manualRefund);
  const rd = rec(row.refundDetails);
  return {
    id: row.id,
    txnRef: row.txnRef,
    status: row.status,
    amount: typeof s.amount === 'number' ? s.amount : null,
    currency: str(s.currency) || null,
    payoutAmount: typeof d.amount === 'number' ? d.amount : null,
    payoutCurrency: str(d.currency) || null,
    signal: storedProviderSignal(row),
    refund:
      row.status === 'REFUNDED'
        ? {
            refundedAt: str(rd.refundedAt) || null,
            markedBy: str(manual.markedBy) || null,
            transactionHash: str(rd.transactionHash) || null,
            amount: str(rd.amount) || null,
            currency: str(rd.currency) || null,
          }
        : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Offramps the provider gave up on and not yet refunded, plus the latest refunds. */
export async function listRefundQueue(): Promise<{ needsReview: RefundQueueRow[]; recentlyRefunded: RefundQueueRow[] }> {
  const offrampRepo = await import('@/db/repositories/offramp.repo');
  const [candidates, refunded] = await Promise.all([
    offrampRepo.listOfframpsWithProviderFailure(200),
    offrampRepo.listRecentlyRefundedOfframps(25),
  ]);
  const needsReview = candidates
    .map(toRefundQueueRow)
    .filter((r) => r.signal != null);
  return { needsReview, recentlyRefunded: refunded.map(toRefundQueueRow) };
}
