/**
 * Fire-and-forget entry for offramp platform-fee settlement after completion.
 */

import * as offrampRepo from '@/db/repositories/offramp.repo';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import { getPalremitOfframpRates } from '@/core/integrations/palremit';
import { createPalremitCurrencyAdapter } from '@/services/palremitAdapters';
import { settleOfframpPlatformFee } from '@/core/offramps/settleOfframpPlatformFee';
import { logger } from '@/lib/logger';

const palremitLiquidity = createPalremitLiquidityAdapter();
const palremitCurrency = createPalremitCurrencyAdapter();

const settlementRepo = {
  findOfframpById: offrampRepo.findOfframpById,
  findOfframpByTxnRef: offrampRepo.findOfframpByTxnRef,
  updateOfframpStatus: offrampRepo.updateOfframpStatus,
};

async function getRateForFeeSettlement(from: string, to: string) {
  const row = await getPalremitOfframpRates(palremitCurrency, from, to);
  if (!row) return null;
  return { conversionRate: row.conversionRate };
}

export async function triggerOfframpPlatformFeeSettlement(offrampId: string): Promise<void> {
  await settleOfframpPlatformFee(settlementRepo, {
    liquidityRequest: palremitLiquidity,
    getRate: getRateForFeeSettlement,
  }, offrampId);
}

export function scheduleOfframpPlatformFeeSettlement(offrampId: string): void {
  void triggerOfframpPlatformFeeSettlement(offrampId).catch((err) => {
    logger.error({ offrampId, err }, 'offramp platform fee settlement trigger failed');
  });
}
