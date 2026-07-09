/**
 * Operator retry: create Palremit fiat withdrawal after crypto confirmed, when the automatic
 * webhook path did not (e.g. missing bank code). Same `txnRef` as `client_reference` on LP.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  advanceOfframpIfDepositReady,
  type AccountRepoAdvance,
  type OfframpRepoAdvance,
} from '@/core/offramps/advanceOfframpPayout';

function getPalremitOrchestrator(providerRefs: unknown): Record<string, unknown> | null {
  if (providerRefs == null || typeof providerRefs !== 'object' || Array.isArray(providerRefs)) {
    return null;
  }
  const o = (providerRefs as Record<string, unknown>).palremitOrchestrator;
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return null;
  return o as Record<string, unknown>;
}

export type RetryOfframpFiatPayoutResult =
  | { status: 'initiated'; withdrawalId: string; txnRef: string }
  | { status: 'already_initiated'; withdrawalId: string; txnRef: string }
  | { status: 'failed_to_initiate'; txnRef: string; message: string }
  | { status: 'rejected'; code: string; message: string; statusCode: number };

/**
 * Idempotent: if a withdrawal id is already recorded, returns `already_initiated` without calling LP.
 * Caller must supply `userId` matching the offramp row (same trust model as create offramp body).
 */
export async function retryOfframpFiatPayout(
  offrampRepo: OfframpRepoAdvance,
  accountRepo: AccountRepoAdvance,
  liquidityRequest: PalremitLiquidityRequestFn,
  params: { offrampId: string; userId: string }
): Promise<RetryOfframpFiatPayoutResult> {
  const row = await offrampRepo.findOfframpById(params.offrampId);
  if (!row?.txnRef) {
    return {
      status: 'rejected',
      code: 'NOT_FOUND',
      message: 'Offramp not found',
      statusCode: 404,
    };
  }

  if (row.userId !== params.userId) {
    return {
      status: 'rejected',
      code: 'FORBIDDEN',
      message: 'userId does not match this offramp',
      statusCode: 403,
    };
  }

  const timeline = (row.timeline as Record<string, unknown>) ?? {};
  const orch = getPalremitOrchestrator(row.providerRefs);
  const fromTimeline =
    typeof timeline.fiatWithdrawalId === 'string' ? timeline.fiatWithdrawalId.trim() : '';
  const fromOrch =
    typeof orch?.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId.trim() : '';
  const existingWd = fromTimeline || fromOrch;

  if (existingWd) {
    return {
      status: 'already_initiated',
      withdrawalId: existingWd,
      txnRef: row.txnRef,
    };
  }

  if (timeline.fiatWithdrawalCompleted === true) {
    return {
      status: 'rejected',
      code: 'PAYOUT_ALREADY_COMPLETED',
      message: 'Fiat payout is already marked completed for this offramp',
      statusCode: 409,
    };
  }

  if (row.status !== 'CRYPTO_CONFIRMED') {
    return {
      status: 'rejected',
      code: 'INVALID_STATUS',
      message: `Retry is only allowed in CRYPTO_CONFIRMED (current: ${row.status})`,
      statusCode: 422,
    };
  }

  await advanceOfframpIfDepositReady(offrampRepo, accountRepo, liquidityRequest, params.offrampId);

  const after = await offrampRepo.findOfframpById(params.offrampId);
  if (!after?.txnRef) {
    return {
      status: 'rejected',
      code: 'NOT_FOUND',
      message: 'Offramp not found after payout attempt',
      statusCode: 404,
    };
  }

  const t2 = (after.timeline as Record<string, unknown>) ?? {};
  const o2 = getPalremitOrchestrator(after.providerRefs);
  const wdTimeline =
    typeof t2.fiatWithdrawalId === 'string' ? t2.fiatWithdrawalId.trim() : '';
  const wdOrch =
    typeof o2?.palremitWithdrawalId === 'string' ? o2.palremitWithdrawalId.trim() : '';
  const wd = wdTimeline || wdOrch;

  if (wd) {
    return { status: 'initiated', withdrawalId: wd, txnRef: after.txnRef };
  }

  return {
    status: 'failed_to_initiate',
    txnRef: after.txnRef,
    message:
      'Palremit did not accept the payout (e.g. missing bank_code on destination account, insufficient LP balance). Fix data and retry with a new requestId.',
  };
}
