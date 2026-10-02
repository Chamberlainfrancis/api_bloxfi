/**
 * Post-completion onramp platform-fee settlement via Palremit USDT/USDC crypto withdrawal.
 * Thin onramp adapter over `core/ramps/settleRampPlatformFee`.
 */

import {
  applyRampPlatformFeeWithdrawalWebhook,
  queueRampPlatformFeeSettlement,
  settleRampPlatformFee,
  type RampFeeSettlementRepo,
  type SettleRampPlatformFeeDeps,
  type SettleRampPlatformFeeResult,
} from '@/core/ramps/settleRampPlatformFee';

export interface SettleOnrampPlatformFeeRepo {
  findOnrampById(id: string): Promise<{
    id: string;
    status: string;
    txnRef: string | null;
    fees: unknown;
  } | null>;
  findOnrampByTxnRef(txnRef: string): Promise<{
    id: string;
    status: string;
    txnRef: string | null;
    fees: unknown;
  } | null>;
  updateOnrampFees(id: string, fees: object): Promise<unknown>;
}

export type SettleOnrampPlatformFeeDeps = SettleRampPlatformFeeDeps;
export type SettleOnrampPlatformFeeResult = SettleRampPlatformFeeResult;

function toRampRepo(repo: SettleOnrampPlatformFeeRepo): RampFeeSettlementRepo {
  return {
    findById: (id) => repo.findOnrampById(id),
    findByTxnRef: (txnRef) => repo.findOnrampByTxnRef(txnRef),
    saveFees: (id, fees) => repo.updateOnrampFees(id, fees),
  };
}

/** Queue platform-fee settlement for admin approval after onramp completion. */
export function queueOnrampPlatformFeeSettlement(
  repo: SettleOnrampPlatformFeeRepo,
  deps: SettleOnrampPlatformFeeDeps,
  onrampId: string
): Promise<SettleOnrampPlatformFeeResult> {
  return queueRampPlatformFeeSettlement('onramp', toRampRepo(repo), deps, onrampId);
}

/** Admin-approved execution of a pending platform-fee settlement. */
export function settleOnrampPlatformFee(
  repo: SettleOnrampPlatformFeeRepo,
  deps: SettleOnrampPlatformFeeDeps,
  onrampId: string
): Promise<SettleOnrampPlatformFeeResult> {
  return settleRampPlatformFee('onramp', toRampRepo(repo), deps, onrampId);
}

export function applyOnrampPlatformFeeWithdrawalWebhook(
  repo: SettleOnrampPlatformFeeRepo,
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
