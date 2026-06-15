/**
 * Admin dashboard orchestration + pure helpers.
 * Backs the no-auth internal ops dashboard. See
 * docs/superpowers/specs/2026-06-15-bloxfi-admin-dashboard-design.md
 *
 * Repo imports are lazy (dynamic import inside async functions) so that
 * the pure helpers (resolveMarkStatus, toListRow, isValidStatus, statusesFor)
 * can be imported and unit-tested without a live DB connection.
 */

import { AppError } from '@/types';

export type TxnType = 'onramp' | 'offramp';
export type MarkOutcome = 'success' | 'failed';

const ONRAMP_STATUSES = [
  'CREATED',
  'AWAITING_FUNDS',
  'FIAT_PENDING',
  'FIAT_PROCESSED',
  'CRYPTO_INITIATED',
  'CRYPTO_PENDING',
  'COMPLETED',
  'FIAT_FAILED',
  'FIAT_RETURNED',
  'CRYPTO_FAILED',
  'EXPIRED',
] as const;

const OFFRAMP_STATUSES = [
  'CREATED',
  'AWAITING_CRYPTO',
  'CRYPTO_PENDING',
  'CRYPTO_RECEIVED',
  'CRYPTO_CONFIRMED',
  'PROCESSING_FEE',
  'FEE_PROCESSED',
  'FIAT_INITIATED',
  'FIAT_PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'CRYPTO_FAILED',
  'FIAT_FAILED',
  'EXPIRED',
] as const;

export function statusesFor(type: TxnType): readonly string[] {
  return type === 'onramp' ? ONRAMP_STATUSES : OFFRAMP_STATUSES;
}

export function isValidStatus(type: TxnType, status: string): boolean {
  return statusesFor(type).includes(status);
}

export function resolveMarkStatus(type: TxnType, outcome: MarkOutcome): string {
  if (outcome === 'success') return 'COMPLETED';
  // Onramp enum has no generic FAILED; FIAT_FAILED is the closest terminal failure.
  return type === 'offramp' ? 'FAILED' : 'FIAT_FAILED';
}

export interface ListRow {
  id: string;
  txnRef: string | null;
  type: TxnType;
  status: string;
  userId: string;
  amount: number | null;
  currency: string | null;
  createdAt: string;
}

interface ListRowInput {
  id: string;
  txnRef: string | null;
  status: string;
  userId: string;
  source: unknown;
  createdAt: Date;
}

export function toListRow(type: TxnType, row: ListRowInput): ListRow {
  const s = (row.source ?? {}) as { amount?: unknown; currency?: unknown };
  return {
    id: row.id,
    txnRef: row.txnRef,
    type,
    status: row.status,
    userId: row.userId,
    amount: typeof s.amount === 'number' ? s.amount : null,
    currency: typeof s.currency === 'string' ? s.currency : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListParams {
  type: TxnType;
  status?: string;
  cursor?: string;
  limit?: number;
}

export async function listTransactions(
  params: ListParams
): Promise<{ items: ListRow[]; nextCursor: string | null }> {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 25;
  let createdBefore: Date | undefined;
  if (params.cursor) {
    createdBefore = new Date(params.cursor);
    if (Number.isNaN(createdBefore.getTime())) {
      throw new AppError('Invalid cursor', 'INVALID_REQUEST', 400);
    }
  }

  if (params.type === 'onramp') {
    const onrampRepo = await import('@/db/repositories/onramp.repo');
    const { onramps, nextCursor } = await onrampRepo.listOnramps({
      status: params.status as never,
      limit,
      createdBefore,
    });
    return {
      items: onramps.map((r) => toListRow('onramp', r)),
      nextCursor: nextCursor ? nextCursor.toISOString() : null,
    };
  }

  const offrampRepo = await import('@/db/repositories/offramp.repo');
  const { offramps, nextCursor } = await offrampRepo.listOfframps({
    status: params.status as never,
    limit,
    createdBefore,
  });
  return {
    items: offramps.map((r) => toListRow('offramp', r)),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}

export async function getTransactionDetail(type: TxnType, id: string): Promise<unknown> {
  const [onrampRepo, offrampRepo, adminActionRepo] = await Promise.all([
    import('@/db/repositories/onramp.repo'),
    import('@/db/repositories/offramp.repo'),
    import('@/db/repositories/adminAction.repo'),
  ]);
  const row =
    type === 'onramp'
      ? await onrampRepo.findOnrampById(id)
      : await offrampRepo.findOfframpById(id);
  if (!row) throw new AppError('Transaction not found', 'NOT_FOUND', 404);
  const adminActions = await adminActionRepo.listAdminActionsForTxn(type, id);

  // For offramps, the beneficiary bank details live on the linked payout Account
  // (destination.accountId), not on the offramp row. Join it in (unmasked — this
  // is the internal ops view) so the dashboard can show who gets paid.
  let beneficiaryAccount: unknown = null;
  if (type === 'offramp') {
    const dest = (row.destination ?? {}) as { accountId?: unknown };
    if (typeof dest.accountId === 'string' && dest.accountId) {
      try {
        const [accountRepo, mapMod] = await Promise.all([
          import('@/db/repositories/account.repo'),
          import('@/core/accounts/mapAccountRow'),
        ]);
        const acct = await accountRepo.findOfframpAccountByIdAndUser(dest.accountId, row.userId);
        if (acct) beneficiaryAccount = mapMod.mapAccountRowToApi(acct, { mask: false });
      } catch {
        // Best-effort: never fail the detail view if the account can't be resolved.
      }
    }
  }

  return { ...row, type, adminActions, beneficiaryAccount };
}

export interface MarkParams {
  type: TxnType;
  id: string;
  outcome: MarkOutcome;
  note?: string;
  actor?: string;
}

export async function markTransaction(params: MarkParams): Promise<unknown> {
  const { type, id, outcome, note, actor } = params;
  const [onrampRepo, offrampRepo, adminActionRepo] = await Promise.all([
    import('@/db/repositories/onramp.repo'),
    import('@/db/repositories/offramp.repo'),
    import('@/db/repositories/adminAction.repo'),
  ]);

  const existing =
    type === 'onramp'
      ? await onrampRepo.findOnrampById(id)
      : await offrampRepo.findOfframpById(id);
  if (!existing) throw new AppError('Transaction not found', 'NOT_FOUND', 404);

  const fromStatus = existing.status;
  const toStatus = resolveMarkStatus(type, outcome);

  // Marking is the manual equivalent of the Palremit withdrawal webhook, applied
  // unconditionally (skipping the webhook's status guards). It is DB-only: the
  // real `withdrawal.successful`/`withdrawal.failed` handlers also make no outbound
  // calls — they finalize the record. We replicate that finalization so receipts,
  // timeline, and providerRefs.withdrawalStatus match a webhook-completed payout.
  const ex = existing as {
    providerRefs?: unknown;
    timeline?: unknown;
    lpReference?: string | null;
    txnRef?: string | null;
  };
  const prevRefs =
    ex.providerRefs && typeof ex.providerRefs === 'object' && !Array.isArray(ex.providerRefs)
      ? (ex.providerRefs as Record<string, unknown>)
      : {};
  const orch =
    prevRefs.palremitOrchestrator &&
    typeof prevRefs.palremitOrchestrator === 'object' &&
    !Array.isArray(prevRefs.palremitOrchestrator)
      ? (prevRefs.palremitOrchestrator as Record<string, unknown>)
      : {};
  const completedAt = new Date().toISOString();

  if (outcome === 'success') {
    // NOTE: the operator note/actor are deliberately NOT stored here. `receipt`
    // is returned by the partner-facing GET /offramps|/onramps API; the note is
    // internal and lives only in the AdminAction audit table below.
    const receipt = {
      provider: 'palremit',
      completedManually: true,
      completedAt,
    };
    const palremitOrchestrator = { ...orch, withdrawalStatus: 'successful', completedAt, markedManually: true };
    if (type === 'onramp') {
      await onrampRepo.updateOnrampStatus(id, 'COMPLETED', {
        failedReason: null,
        receipt,
        providerRefs: { ...prevRefs, palremitOrchestrator },
      });
    } else {
      const prevTimeline =
        ex.timeline && typeof ex.timeline === 'object' && !Array.isArray(ex.timeline)
          ? (ex.timeline as Record<string, unknown>)
          : {};
      await offrampRepo.updateOfframpStatus(id, 'COMPLETED', {
        failedReason: null,
        receipt,
        timeline: { ...prevTimeline, completedAt, fiatWithdrawalCompleted: true },
        lpReference: ex.lpReference ?? ex.txnRef ?? undefined,
        providerRefs: { ...prevRefs, palremitOrchestrator },
      });
    }
  } else {
    // failed — failedReason is partner-facing (returned by the public API), so use
    // a generic operator message rather than the internal note. The note/actor are
    // kept internal in the AdminAction audit table below.
    const failedReason = 'Marked failed by operator';
    const palremitOrchestrator = { ...orch, withdrawalStatus: 'failed', markedManually: true };
    if (type === 'onramp') {
      await onrampRepo.updateOnrampStatus(id, toStatus as never, {
        failedReason,
        providerRefs: { ...prevRefs, palremitOrchestrator },
      });
    } else {
      await offrampRepo.updateOfframpStatus(id, toStatus as never, {
        failedReason,
        providerRefs: { ...prevRefs, palremitOrchestrator },
      });
    }
  }

  // Sequential (not transactional): repos share one prisma client and don't expose
  // a tx handle. Acceptable for an internal tool; status write is the source of truth.
  await adminActionRepo.createAdminAction({
    txnType: type,
    txnId: id,
    fromStatus,
    toStatus,
    note: note ?? null,
    actor: actor ?? null,
  });

  return getTransactionDetail(type, id);
}
