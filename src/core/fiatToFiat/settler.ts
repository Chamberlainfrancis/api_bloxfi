/**
 * Production wiring for fiat-to-fiat internal settlement, shared by every
 * caller of advanceOnrampIfFiatProcessed (webhook, GET retry, admin credit)
 * so none of them sends the crypto on-chain while another would settle it.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import type { SettleOnrampInternallyFn } from '@/core/onramps/advanceOnrampPayout';
import { advanceOfframpIfDepositReady } from '@/core/offramps/advanceOfframpPayout';
import { scheduleOnrampPlatformFeeSettlement } from '@/core/onramps/triggerOnrampPlatformFeeSettlement';
import { trySettleFiatToFiatInternally } from '@/core/fiatToFiat/internalSettlement';
import * as onrampRepo from '@/db/repositories/onramp.repo';
import * as offrampRepo from '@/db/repositories/offramp.repo';
import * as accountRepo from '@/db/repositories/account.repo';

export function createFiatToFiatSettler(palremitLiquidity: PalremitLiquidityRequestFn): SettleOnrampInternallyFn {
  return (row) =>
    trySettleFiatToFiatInternally(
      {
        findOpenOfframpsByDepositAddress: offrampRepo.findOpenOfframpsByDepositAddress,
        findOfframpByTxnRef: offrampRepo.findOfframpByTxnRef,
        claimOfframpCrypto: offrampRepo.claimOfframpCrypto,
        updateOnrampStatus: onrampRepo.updateOnrampStatus,
        afterOnrampCompleted: scheduleOnrampPlatformFeeSettlement,
        advanceOfframpPayout: (offrampId) =>
          advanceOfframpIfDepositReady(
            {
              findOfframpById: offrampRepo.findOfframpById,
              updateOfframpStatus: offrampRepo.updateOfframpStatus,
            },
            { findOfframpAccountByIdAndUser: accountRepo.findOfframpAccountByIdAndUser },
            palremitLiquidity,
            offrampId
          ),
      },
      row
    );
}
