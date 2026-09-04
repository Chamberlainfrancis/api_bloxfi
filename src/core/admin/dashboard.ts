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
import { logger } from '@/lib/logger';
import { buildAuditTrail } from '@/core/admin/auditTrail';
import {
  canReissueOfframpFiatPayout,
  canRetryOfframpHandoff,
  offrampFiatWithdrawalId,
  storedWithdrawalStatus,
} from '@/core/offramps/offrampFiatRetry';
import {
  expireOnrampIfDepositPastDue,
  expireOfframpIfDepositPastDue,
  expireStaleOnramps,
  expireStaleOfframps,
} from '@/core/ramps/depositExpiry';

export type TxnType = 'onramp' | 'offramp';
export type MarkOutcome = 'success' | 'failed';

export function sumProfitUsdc(rows: Array<{ profit?: unknown }>): string {
  let total = 0;
  for (const r of rows) {
    const p = r.profit;
    if (p == null || typeof p !== 'object') continue;
    const v = (p as { amountUsdc?: unknown }).amountUsdc;
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    if (Number.isFinite(n)) total += n;
  }
  return total.toFixed(8);
}

export async function getTotalRealizedProfitUsdc(): Promise<string> {
  const [onrampRepo, offrampRepo] = await Promise.all([
    import('@/db/repositories/onramp.repo'),
    import('@/db/repositories/offramp.repo'),
  ]);
  const [on, off] = await Promise.all([
    onrampRepo.findCompletedProfits(),
    offrampRepo.findCompletedProfits(),
  ]);
  return sumProfitUsdc([...on, ...off]);
}

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

const TERMINAL_WITHDRAWAL_STATUSES = new Set(['successful', 'failed']);

/** Statuses where the LP payout handoff has started but the withdrawal webhook may not have arrived. */
const PAYOUT_SENT_STATUSES: Record<TxnType, readonly string[]> = {
  onramp: ['CRYPTO_INITIATED', 'CRYPTO_PENDING'],
  offramp: ['FIAT_INITIATED', 'FIAT_PENDING'],
};

/** True when Palremit has an in-flight withdrawal (pending webhook). */
export function isWithdrawalProcessing(
  type: TxnType,
  status: string,
  providerRefs: unknown
): boolean {
  const orch = orchRefs(providerRefs);
  const ws =
    typeof orch.withdrawalStatus === 'string' ? orch.withdrawalStatus.trim().toLowerCase() : '';
  if (TERMINAL_WITHDRAWAL_STATUSES.has(ws)) return false;

  const hasWithdrawalId =
    typeof orch.palremitWithdrawalId === 'string' && orch.palremitWithdrawalId.trim() !== '';
  const payoutSent = hasWithdrawalId || PAYOUT_SENT_STATUSES[type].includes(status);
  if (!payoutSent) return false;

  return ws === 'pending' || ws === 'processing' || ws === '';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value != null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function orchRefs(providerRefs: unknown): Record<string, unknown> {
  return asRecord(asRecord(providerRefs).palremitOrchestrator);
}

/** Last Palremit fiat-payout rejection (persisted when LP returns non-202). */
export function extractFiatPayoutError(row: {
  timeline?: unknown;
  providerRefs?: unknown;
}): string | null {
  const timeline = asRecord(row.timeline);
  const orch = orchRefs(row.providerRefs);
  const fromTimeline =
    typeof timeline.fiatPayoutLastError === 'string' ? timeline.fiatPayoutLastError.trim() : '';
  if (fromTimeline) return fromTimeline;
  const fromOrch =
    typeof orch.fiatPayoutLastError === 'string' ? orch.fiatPayoutLastError.trim() : '';
  return fromOrch || null;
}

/** Operator may retry fiat payout when handoff never started, or LP failed/refunded. */
export function canRetryOfframpFiatPayout(row: {
  status: string;
  timeline?: unknown;
  providerRefs?: unknown;
  lpWithdrawalState?: string | null;
}): boolean {
  if (canRetryOfframpHandoff(row)) return true;
  return canReissueOfframpFiatPayout({
    withdrawalId: offrampFiatWithdrawalId(row),
    lpState: row.lpWithdrawalState ?? null,
    storedWithdrawalStatus: storedWithdrawalStatus(row.providerRefs),
  });
}

export interface ListRow {
  id: string;
  txnRef: string | null;
  type: TxnType;
  status: string;
  userId: string;
  amount: number | null;
  currency: string | null;
  beneficiaryName: string | null;
  createdAt: string;
}

interface ListRowInput {
  id: string;
  txnRef: string | null;
  status: string;
  userId: string;
  source: unknown;
  destination?: unknown;
  createdAt: Date;
}

type EmbeddedUser = { businessName?: unknown; firstName?: unknown; lastName?: unknown };

/** Best-effort name out of the embedded `user` snapshot stored on source/destination. */
function nameFromEmbeddedUser(user: unknown): string | null {
  const u = (user ?? {}) as EmbeddedUser;
  if (typeof u.businessName === 'string' && u.businessName) return u.businessName;
  const first = typeof u.firstName === 'string' ? u.firstName : '';
  const last = typeof u.lastName === 'string' ? u.lastName : '';
  const full = `${first} ${last}`.trim();
  return full || null;
}

export function toListRow(
  type: TxnType,
  row: ListRowInput,
  beneficiaryAccountName?: string | null
): ListRow {
  const s = (row.source ?? {}) as { amount?: unknown; currency?: unknown; user?: unknown };
  const d = (row.destination ?? {}) as { user?: unknown };
  // Offramps prefer the linked payout account's holder name (the actual fiat
  // beneficiary, which can differ from the BloxFi customer); fall back to the
  // embedded user snapshots so the column is never empty when one exists.
  const beneficiaryName =
    beneficiaryAccountName || nameFromEmbeddedUser(s.user) || nameFromEmbeddedUser(d.user) || null;
  return {
    id: row.id,
    txnRef: row.txnRef,
    type,
    status: row.status,
    userId: row.userId,
    amount: typeof s.amount === 'number' ? s.amount : null,
    currency: typeof s.currency === 'string' ? s.currency : null,
    beneficiaryName,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ListParams {
  type: TxnType;
  status?: string;
  includeExpired?: boolean;
  cursor?: string;
  limit?: number;
  userId?: string;
}

async function expireStaleRampsForType(type: TxnType): Promise<void> {
  if (type === 'onramp') {
    const onrampRepo = await import('@/db/repositories/onramp.repo');
    const expired = await expireStaleOnramps(
      onrampRepo.listOnrampsAwaitingDeposit,
      onrampRepo
    );
    if (expired > 0) {
      logger.info({ type, expired }, 'expired stale onramps past deposit window');
    }
    return;
  }
  const offrampRepo = await import('@/db/repositories/offramp.repo');
  const expired = await expireStaleOfframps(
    offrampRepo.listOfframpsAwaitingDeposit,
    offrampRepo
  );
  if (expired > 0) {
    logger.info({ type, expired }, 'expired stale offramps past deposit window');
  }
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

  await expireStaleRampsForType(params.type);

  const excludeExpired = !params.includeExpired && !params.status;

  if (params.type === 'onramp') {
    const onrampRepo = await import('@/db/repositories/onramp.repo');
    const { onramps, nextCursor } = await onrampRepo.listOnramps({
      userId: params.userId,
      status: params.status as never,
      excludeStatuses: excludeExpired ? (['EXPIRED'] as const) : undefined,
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
    userId: params.userId,
    status: params.status as never,
    excludeStatuses: excludeExpired ? (['EXPIRED'] as const) : undefined,
    limit,
    createdBefore,
  });

  const accountIds = [
    ...new Set(
      offramps
        .map((r) => (r.destination as { accountId?: unknown } | null)?.accountId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ];
  const accountNameById = new Map<string, string>();
  if (accountIds.length) {
    const accountRepo = await import('@/db/repositories/account.repo');
    const accounts = await accountRepo.findAccountsByIds(accountIds);
    for (const acct of accounts) {
      const name = (acct.accountHolder as { name?: unknown } | null)?.name;
      if (typeof name === 'string' && name) accountNameById.set(acct.id, name);
    }
  }

  return {
    items: offramps.map((r) => {
      const accountId = (r.destination as { accountId?: unknown } | null)?.accountId;
      const beneficiaryName = typeof accountId === 'string' ? accountNameById.get(accountId) : undefined;
      return toListRow('offramp', r, beneficiaryName ?? null);
    }),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}

export async function getTransactionDetail(type: TxnType, id: string): Promise<unknown> {
  const [onrampRepo, offrampRepo, adminActionRepo] = await Promise.all([
    import('@/db/repositories/onramp.repo'),
    import('@/db/repositories/offramp.repo'),
    import('@/db/repositories/adminAction.repo'),
  ]);

  if (type === 'onramp') {
    const existing = await onrampRepo.findOnrampById(id);
    if (existing) {
      await expireOnrampIfDepositPastDue(existing, onrampRepo);
    }
  } else {
    const existing = await offrampRepo.findOfframpById(id);
    if (existing) {
      await expireOfframpIfDepositPastDue(existing, offrampRepo);
    }
  }

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

  let lpWithdrawalState: string | null = null;
  if (type === 'offramp') {
    const wdId = offrampFiatWithdrawalId(row);
    if (wdId) {
      try {
        const { createPalremitLiquidityAdapter } = await import('@/services/palremitAdapters');
        const { getPalremitWithdrawalById } = await import('@/core/integrations/palremitLiquidity');
        const live = await getPalremitWithdrawalById(createPalremitLiquidityAdapter(), wdId);
        lpWithdrawalState = live?.state ? live.state.toLowerCase() : null;
      } catch {
        lpWithdrawalState = null;
      }
    }
  }

  return {
    ...row,
    type,
    adminActions,
    beneficiaryAccount,
    withdrawalProcessing: isWithdrawalProcessing(type, row.status, row.providerRefs),
    payoutError: type === 'offramp' ? extractFiatPayoutError(row) : null,
    lpWithdrawalState,
    canRetryFiatPayout:
      type === 'offramp' ? canRetryOfframpFiatPayout({ ...row, lpWithdrawalState }) : false,
    canReissueFiatPayout:
      type === 'offramp'
        ? canReissueOfframpFiatPayout({
            withdrawalId: offrampFiatWithdrawalId(row),
            lpState: lpWithdrawalState,
            storedWithdrawalStatus: storedWithdrawalStatus(row.providerRefs),
          })
        : false,
    feeSettlementPending:
      type === 'offramp' &&
      (() => {
        const fees =
          row.fees != null && typeof row.fees === 'object' && !Array.isArray(row.fees)
            ? (row.fees as Record<string, unknown>)
            : {};
        const pf =
          fees.platformFee != null &&
          typeof fees.platformFee === 'object' &&
          !Array.isArray(fees.platformFee)
            ? (fees.platformFee as Record<string, unknown>)
            : {};
        const settlement =
          pf.settlement != null &&
          typeof pf.settlement === 'object' &&
          !Array.isArray(pf.settlement)
            ? (pf.settlement as Record<string, unknown>)
            : {};
        return settlement.status === 'pending';
      })(),
    auditTrail: buildAuditTrail(type, row, adminActions),
  };
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
      const { scheduleOfframpPlatformFeeSettlement } = await import(
        '@/core/offramps/triggerOfframpPlatformFeeSettlement'
      );
      scheduleOfframpPlatformFeeSettlement(id);
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

export interface MarkOnrampFiatReceivedParams {
  id: string;
  reason: string;
  code: string;
  actor?: string;
}

/**
 * Ops marks fiat deposit as received (manual path for static-fallback /
 * stuck AWAITING_FUNDS|FIAT_PENDING onramps). Advances crypto payout like
 * `deposit.credited`.
 */
export async function markOnrampFiatReceived(
  params: MarkOnrampFiatReceivedParams
): Promise<unknown> {
  const reason = params.reason.trim();
  const code = params.code.trim();
  if (!reason) throw new AppError('reason is required', 'INVALID_REQUEST', 400);
  if (!code) throw new AppError('code is required', 'INVALID_REQUEST', 400);

  const [onrampRepo, adminActionRepo] = await Promise.all([
    import('@/db/repositories/onramp.repo'),
    import('@/db/repositories/adminAction.repo'),
  ]);

  const existing = await onrampRepo.findOnrampById(params.id);
  if (!existing) throw new AppError('Transaction not found', 'NOT_FOUND', 404);

  const fromStatus = existing.status;
  if (!['AWAITING_FUNDS', 'FIAT_PENDING'].includes(fromStatus)) {
    throw new AppError(
      `Cannot mark fiat received from status ${fromStatus}`,
      'INVALID_STATE',
      409
    );
  }

  // Ops is confirming funds arrived — do not expire even if depositBy has passed.

  const prevRefs =
    existing.providerRefs &&
    typeof existing.providerRefs === 'object' &&
    !Array.isArray(existing.providerRefs)
      ? (existing.providerRefs as Record<string, unknown>)
      : {};
  const orch =
    prevRefs.palremitOrchestrator &&
    typeof prevRefs.palremitOrchestrator === 'object' &&
    !Array.isArray(prevRefs.palremitOrchestrator)
      ? (prevRefs.palremitOrchestrator as Record<string, unknown>)
      : {};
  const creditedAt = new Date().toISOString();
  const actor = params.actor?.trim() || null;
  const note = `code=${code} | ${reason}`;

  await onrampRepo.updateOnrampStatus(params.id, 'FIAT_PROCESSED', {
    receipt: {
      provider: 'manual_ops',
      completedManually: true,
      creditedAt,
      code,
      reason,
    },
    providerRefs: {
      ...prevRefs,
      palremitOrchestrator: {
        ...orch,
        depositStatus: 'credited',
        markedManually: true,
      },
      manualFiatCredit: {
        code,
        reason,
        actor,
        creditedAt,
      },
    },
  });

  await adminActionRepo.createAdminAction({
    txnType: 'onramp',
    txnId: params.id,
    fromStatus,
    toStatus: 'FIAT_PROCESSED',
    note,
    actor,
  });

  try {
    const { advanceOnrampIfFiatProcessed } = await import('@/core/onramps/advanceOnrampPayout');
    const { executePalremitOnrampCryptoWithdrawal } = await import('@/core/integrations');
    const { createPalremitLiquidityAdapter } = await import('@/services/palremitAdapters');
    const palremitLiquidity = createPalremitLiquidityAdapter();
    await advanceOnrampIfFiatProcessed(
      {
        findOnrampById: onrampRepo.findOnrampById,
        updateOnrampStatus: onrampRepo.updateOnrampStatus,
      },
      params.id,
      (b, rid, receiveNet, destAddr, txnRef, destMemo) =>
        executePalremitOnrampCryptoWithdrawal(
          palremitLiquidity,
          b,
          rid,
          receiveNet,
          destAddr,
          txnRef,
          destMemo
        )
    );
  } catch (e) {
    logger.error({ onrampId: params.id, err: e }, 'markOnrampFiatReceived advance failed');
  }

  return getTransactionDetail('onramp', params.id);
}

export interface PendingFeeSettlementRow {
  offrampId: string;
  txnRef: string | null;
  settlementStatus: string | null;
  feeAmount: string | null;
  feeCurrency: string | null;
  walletAddress: string | null;
  settlementNetwork: string | null;
  settlementCurrency: string | null;
  sendAmount: number | null;
  sendCurrency: string | null;
  receiveAmount: number | null;
  receiveCurrency: string | null;
  queuedAt: string | null;
  createdAt: string;
}

function toPendingFeeSettlementRow(row: {
  id: string;
  txnRef: string | null;
  source: unknown;
  destination?: unknown;
  fees: unknown;
  createdAt: Date;
}): PendingFeeSettlementRow {
  const fees =
    row.fees != null && typeof row.fees === 'object' && !Array.isArray(row.fees)
      ? (row.fees as Record<string, unknown>)
      : {};
  const pf =
    fees.platformFee != null &&
    typeof fees.platformFee === 'object' &&
    !Array.isArray(fees.platformFee)
      ? (fees.platformFee as Record<string, unknown>)
      : {};
  const settlement =
    pf.settlement != null &&
    typeof pf.settlement === 'object' &&
    !Array.isArray(pf.settlement)
      ? (pf.settlement as Record<string, unknown>)
      : {};
  const src = (row.source ?? {}) as { amount?: unknown; currency?: unknown };
  const dest = (row.destination ?? {}) as { amount?: unknown; currency?: unknown };
  return {
    offrampId: row.id,
    txnRef: row.txnRef,
    settlementStatus: typeof settlement.status === 'string' ? settlement.status : null,
    feeAmount: typeof pf.amount === 'string' ? pf.amount : null,
    feeCurrency: typeof pf.currency === 'string' ? pf.currency : null,
    walletAddress: typeof pf.walletAddress === 'string' ? pf.walletAddress : null,
    settlementNetwork:
      typeof pf.settlementNetwork === 'string' ? pf.settlementNetwork : null,
    settlementCurrency:
      typeof pf.settlementCurrency === 'string' ? pf.settlementCurrency : null,
    sendAmount: typeof src.amount === 'number' ? src.amount : null,
    sendCurrency: typeof src.currency === 'string' ? src.currency : null,
    receiveAmount: typeof dest.amount === 'number' ? dest.amount : null,
    receiveCurrency: typeof dest.currency === 'string' ? dest.currency : null,
    queuedAt: typeof settlement.attemptedAt === 'string' ? settlement.attemptedAt : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listPendingFeeSettlements(params: {
  cursor?: string;
  limit?: number;
}): Promise<{ items: PendingFeeSettlementRow[]; nextCursor: string | null }> {
  const limit = params.limit && params.limit > 0 ? Math.min(params.limit, 100) : 25;
  let createdBefore: Date | undefined;
  if (params.cursor) {
    createdBefore = new Date(params.cursor);
    if (Number.isNaN(createdBefore.getTime())) {
      throw new AppError('Invalid cursor', 'INVALID_REQUEST', 400);
    }
  }

  const offrampRepo = await import('@/db/repositories/offramp.repo');
  const { offramps, nextCursor } = await offrampRepo.listOfframpsFeeSettlementsForAdmin({
    limit,
    createdBefore,
  });
  return {
    items: offramps.map(toPendingFeeSettlementRow),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}

export interface ApproveFeeSettlementParams {
  offrampId: string;
  actor?: string;
}

export async function approveFeeSettlement(
  params: ApproveFeeSettlementParams
): Promise<{ outcome: string; settlement?: unknown; row: PendingFeeSettlementRow | null }> {
  const offrampRepo = await import('@/db/repositories/offramp.repo');
  const row = await offrampRepo.findOfframpById(params.offrampId);
  if (!row) throw new AppError('Offramp not found', 'NOT_FOUND', 404);

  const fees =
    row.fees != null && typeof row.fees === 'object' && !Array.isArray(row.fees)
      ? (row.fees as Record<string, unknown>)
      : {};
  const pf =
    fees.platformFee != null &&
    typeof fees.platformFee === 'object' &&
    !Array.isArray(fees.platformFee)
      ? (fees.platformFee as Record<string, unknown>)
      : {};
  const settlement =
    pf.settlement != null &&
    typeof pf.settlement === 'object' &&
    !Array.isArray(pf.settlement)
      ? (pf.settlement as Record<string, unknown>)
      : {};
  const settlementStatus =
    typeof settlement.status === 'string' ? settlement.status : '';
  if (settlementStatus !== 'pending' && settlementStatus !== 'failed') {
    throw new AppError(
      'Fee settlement is not pending approval or retryable',
      'INVALID_REQUEST',
      400
    );
  }

  const { triggerOfframpPlatformFeeSettlement } = await import(
    '@/core/offramps/triggerOfframpPlatformFeeSettlement'
  );
  const result = await triggerOfframpPlatformFeeSettlement(params.offrampId);
  if (result.outcome !== 'processing' && result.outcome !== 'already_settled') {
    throw new AppError(
      `Fee settlement could not be started (${result.outcome})`,
      'INVALID_REQUEST',
      400
    );
  }

  const updated = await offrampRepo.findOfframpById(params.offrampId);

  const adminActionRepo = await import('@/db/repositories/adminAction.repo');
  await adminActionRepo.createAdminAction({
    txnType: 'offramp',
    txnId: params.offrampId,
    fromStatus: settlementStatus === 'failed' ? 'fee:failed' : 'fee:pending',
    toStatus:
      result.outcome === 'already_settled' ? 'fee:completed' : 'fee:processing',
    note:
      settlementStatus === 'failed'
        ? 'Retried platform fee settlement'
        : 'Approved platform fee settlement',
    actor: params.actor ?? null,
  });

  logger.info(
    { offrampId: params.offrampId, actor: params.actor, outcome: result.outcome },
    'admin approved platform fee settlement'
  );
  return {
    outcome: result.outcome,
    settlement: result.settlement,
    row: updated ? toPendingFeeSettlementRow(updated) : null,
  };
}

export interface RetryOfframpFiatPayoutAdminParams {
  offrampId: string;
  actor?: string;
}

export async function retryOfframpFiatPayoutAdmin(
  params: RetryOfframpFiatPayoutAdminParams
): Promise<{
  status: string;
  withdrawalId?: string;
  previousWithdrawalId?: string;
  txnRef?: string;
  message?: string;
  detail: unknown;
}> {
  const [offrampRepo, accountRepo, adminActionRepo, retryMod] = await Promise.all([
    import('@/db/repositories/offramp.repo'),
    import('@/db/repositories/account.repo'),
    import('@/db/repositories/adminAction.repo'),
    import('@/core/offramps/retryOfframpFiatPayout'),
  ]);
  const { createPalremitLiquidityAdapter } = await import('@/services/palremitAdapters');
  const { getPalremitWithdrawalById } = await import('@/core/integrations/palremitLiquidity');
  const { decideOfframpFiatRetry, offrampFiatWithdrawalId } = await import(
    '@/core/offramps/offrampFiatRetry'
  );
  const liquidityRequest = createPalremitLiquidityAdapter();

  const existing = await offrampRepo.findOfframpById(params.offrampId);
  if (!existing) throw new AppError('Offramp not found', 'NOT_FOUND', 404);

  const existingWd = offrampFiatWithdrawalId(existing);
  if (existingWd) {
    let lpState: string | null = null;
    try {
      const live = await getPalremitWithdrawalById(liquidityRequest, existingWd);
      lpState = live?.state ? live.state.toLowerCase() : null;
    } catch {
      lpState = null;
    }
    const decision = decideOfframpFiatRetry({ withdrawalId: existingWd, lpState });
    if (decision.action === 'reject') {
      throw new AppError(decision.message, decision.code, decision.statusCode);
    }
    if (decision.action === 'already_initiated') {
      const detail = await getTransactionDetail('offramp', params.offrampId);
      return {
        status: 'already_initiated',
        withdrawalId: decision.withdrawalId,
        txnRef: existing.txnRef ?? undefined,
        detail,
      };
    }
    if (decision.action === 'reissue') {
      const reissueMod = await import('@/core/offramps/reissueOfframpFiatPayout');
      const reissued = await reissueMod.reissueOfframpFiatPayout(
        {
          findOfframpById: offrampRepo.findOfframpById,
          updateOfframpStatus: offrampRepo.updateOfframpStatus,
        },
        liquidityRequest,
        { offrampId: params.offrampId, withdrawalId: decision.withdrawalId }
      );
      if (reissued.status === 'rejected') {
        throw new AppError(reissued.message, reissued.code, reissued.statusCode);
      }
      const detail = await getTransactionDetail('offramp', params.offrampId);
      await adminActionRepo.createAdminAction({
        txnType: 'offramp',
        txnId: params.offrampId,
        fromStatus: existing.status,
        toStatus: 'FIAT_PENDING',
        note: `Fiat payout reissued (${reissued.previousWithdrawalId} → ${reissued.withdrawalId})`,
        actor: params.actor ?? null,
      });
      logger.info(
        {
          offrampId: params.offrampId,
          actor: params.actor,
          previousWithdrawalId: reissued.previousWithdrawalId,
          withdrawalId: reissued.withdrawalId,
        },
        'admin reissued offramp fiat payout'
      );
      return {
        status: 'reissued',
        withdrawalId: reissued.withdrawalId,
        previousWithdrawalId: reissued.previousWithdrawalId,
        txnRef: reissued.txnRef,
        detail,
      };
    }
  }

  const outcome = await retryMod.retryOfframpFiatPayout(
    {
      findOfframpById: offrampRepo.findOfframpById,
      updateOfframpStatus: offrampRepo.updateOfframpStatus,
    },
    { findOfframpAccountByIdAndUser: accountRepo.findOfframpAccountByIdAndUser },
    liquidityRequest,
    { offrampId: params.offrampId, userId: existing.userId }
  );

  if (outcome.status === 'rejected') {
    throw new AppError(outcome.message, outcome.code, outcome.statusCode);
  }

  const detail = await getTransactionDetail('offramp', params.offrampId);

  if (outcome.status === 'initiated' || outcome.status === 'already_initiated') {
    await adminActionRepo.createAdminAction({
      txnType: 'offramp',
      txnId: params.offrampId,
      fromStatus: existing.status,
      toStatus: outcome.status === 'initiated' ? 'FIAT_PENDING' : existing.status,
      note:
        outcome.status === 'already_initiated'
          ? `Fiat payout retry — already initiated (${outcome.withdrawalId})`
          : `Fiat payout retry initiated (${outcome.withdrawalId})`,
      actor: params.actor ?? null,
    });
    logger.info(
      { offrampId: params.offrampId, actor: params.actor, status: outcome.status },
      'admin retried offramp fiat payout'
    );
    return {
      status: outcome.status,
      withdrawalId: outcome.withdrawalId,
      txnRef: outcome.txnRef,
      detail,
    };
  }

  await adminActionRepo.createAdminAction({
    txnType: 'offramp',
    txnId: params.offrampId,
    fromStatus: existing.status,
    toStatus: existing.status,
    note: `Fiat payout retry failed: ${outcome.message}`,
    actor: params.actor ?? null,
  });

  throw new AppError(outcome.message, 'PAYOUT_RETRY_FAILED', 422);
}
