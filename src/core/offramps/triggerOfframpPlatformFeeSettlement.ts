/**
 * Fire-and-forget entry for offramp platform-fee settlement after completion.
 */

import * as offrampRepo from '@/db/repositories/offramp.repo';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import {
  queueOfframpPlatformFeeSettlement,
  settleOfframpPlatformFee,
} from '@/core/offramps/settleOfframpPlatformFee';
import { logger } from '@/lib/logger';

const palremitLiquidity = createPalremitLiquidityAdapter();

const settlementRepo = {
  findOfframpById: offrampRepo.findOfframpById,
  findOfframpByTxnRef: offrampRepo.findOfframpByTxnRef,
  updateOfframpStatus: offrampRepo.updateOfframpStatus,
};

const settlementDeps = {
  liquidityRequest: palremitLiquidity,
};

/** Queue settlement as pending (called automatically when an offramp completes). */
export async function triggerOfframpPlatformFeeSettlementQueue(
  offrampId: string
): Promise<void> {
  await queueOfframpPlatformFeeSettlement(settlementRepo, settlementDeps, offrampId);
}

export function scheduleOfframpPlatformFeeSettlement(offrampId: string): void {
  void triggerOfframpPlatformFeeSettlementQueue(offrampId).catch((err) => {
    logger.error({ offrampId, err }, 'offramp platform fee settlement queue failed');
  });
}

/** Execute an admin-approved pending settlement. */
export async function triggerOfframpPlatformFeeSettlement(offrampId: string) {
  return settleOfframpPlatformFee(settlementRepo, settlementDeps, offrampId);
}
