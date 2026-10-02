/**
 * Fire-and-forget entry for onramp platform-fee settlement after completion.
 */

import * as onrampRepo from '@/db/repositories/onramp.repo';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import {
  queueOnrampPlatformFeeSettlement,
  settleOnrampPlatformFee,
} from '@/core/onramps/settleOnrampPlatformFee';
import { logger } from '@/lib/logger';

const palremitLiquidity = createPalremitLiquidityAdapter();

export const onrampFeeSettlementRepo = {
  findOnrampById: onrampRepo.findOnrampById,
  findOnrampByTxnRef: onrampRepo.findOnrampByTxnRef,
  updateOnrampFees: onrampRepo.updateOnrampFees,
};

const settlementDeps = {
  liquidityRequest: palremitLiquidity,
};

/** Queue settlement as pending (called automatically when an onramp completes). */
export async function triggerOnrampPlatformFeeSettlementQueue(
  onrampId: string
): Promise<void> {
  await queueOnrampPlatformFeeSettlement(onrampFeeSettlementRepo, settlementDeps, onrampId);
}

export function scheduleOnrampPlatformFeeSettlement(onrampId: string): void {
  void triggerOnrampPlatformFeeSettlementQueue(onrampId).catch((err) => {
    logger.error({ onrampId, err }, 'onramp platform fee settlement queue failed');
  });
}

/** Execute an admin-approved pending settlement. */
export async function triggerOnrampPlatformFeeSettlement(onrampId: string) {
  return settleOnrampPlatformFee(onrampFeeSettlementRepo, settlementDeps, onrampId);
}
