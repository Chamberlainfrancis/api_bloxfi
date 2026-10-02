/**
 * Post-completion offramp platform-fee settlement via Palremit USDT/USDC crypto withdrawal.
 * Thin offramp adapter over `core/ramps/settleRampPlatformFee`.
 */

import type { OfframpStatus } from '@/types/offramp';
import {
  applyRampPlatformFeeWithdrawalWebhook,
  queueRampPlatformFeeSettlement,
  settleRampPlatformFee,
  type RampFeeSettlementRepo,
  type SettleRampPlatformFeeDeps,
  type SettleRampPlatformFeeOutcome,
  type SettleRampPlatformFeeResult,
} from '@/core/ramps/settleRampPlatformFee';

export { withdrawalSettlementHash } from '@/core/ramps/settleRampPlatformFee';

export interface SettleOfframpPlatformFeeRepo {
  findOfframpById(id: string): Promise<{
    id: string;
    status: string;
    txnRef: string | null;
    fees: unknown;
  } | null>;
  findOfframpByTxnRef(txnRef: string): Promise<{
    id: string;
    status: string;
    txnRef: string | null;
    fees: unknown;
  } | null>;
  updateOfframpStatus(
    id: string,
    status: OfframpStatus,
    updates?: { fees?: object | null }
  ): Promise<unknown>;
}

export type SettleOfframpPlatformFeeDeps = SettleRampPlatformFeeDeps;
export type SettleOfframpPlatformFeeOutcome = SettleRampPlatformFeeOutcome;
export type SettleOfframpPlatformFeeResult = SettleRampPlatformFeeResult;

function toRampRepo(repo: SettleOfframpPlatformFeeRepo): RampFeeSettlementRepo {
  return {
    findById: (id) => repo.findOfframpById(id),
    findByTxnRef: (txnRef) => repo.findOfframpByTxnRef(txnRef),
    saveFees: (id, fees) => repo.updateOfframpStatus(id, 'COMPLETED', { fees }),
  };
}

/** Queue platform-fee settlement for admin approval after offramp completion. */
export function queueOfframpPlatformFeeSettlement(
  repo: SettleOfframpPlatformFeeRepo,
  deps: SettleOfframpPlatformFeeDeps,
  offrampId: string
): Promise<SettleOfframpPlatformFeeResult> {
  return queueRampPlatformFeeSettlement('offramp', toRampRepo(repo), deps, offrampId);
}

/** Admin-approved execution of a pending platform-fee settlement. */
export function settleOfframpPlatformFee(
  repo: SettleOfframpPlatformFeeRepo,
  deps: SettleOfframpPlatformFeeDeps,
  offrampId: string
): Promise<SettleOfframpPlatformFeeResult> {
  return settleRampPlatformFee('offramp', toRampRepo(repo), deps, offrampId);
}

export function applyOfframpPlatformFeeWithdrawalWebhook(
  repo: SettleOfframpPlatformFeeRepo,
  parentTxnRef: string,
  withdrawal: Record<string, unknown>,
  terminal: 'completed' | 'failed',
  failureNote?: string
): Promise<boolean> {
  return applyRampPlatformFeeWithdrawalWebhook(
    toRampRepo(repo),
    parentTxnRef,
    withdrawal,
    terminal,
    failureNote
  );
}
