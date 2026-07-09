/**
 * Core: update offramp payout account destination (partial merge + live corridor re-validation).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { mergePalremitDestination } from '@/core/accounts/mergePalremitDestination';
import {
  buildValidatedProviderPayout,
  rethrowPalremitCorridorError,
} from '@/core/accounts/providerPayoutBuild';
import { mapAccountRowToApi, type AccountRowLike } from '@/core/accounts/mapAccountRow';
import { parseProviderPayout } from '@/core/accounts/providerPayoutHelpers';
import type { GetAccountResponse, UpdateAccountRequest } from '@/types/account';

export interface AccountRepoUpdate {
  findOfframpAccountByIdAndUser(
    accountId: string,
    userId: string
  ): Promise<AccountRowLike | null>;
  updateAccountProviderPayout(
    accountId: string,
    userId: string,
    providerPayout: object
  ): Promise<AccountRowLike | null>;
}

export interface UpdateAccountOptions {
  palremitLiquidityRequest: PalremitLiquidityRequestFn;
}

export async function updateAccount(
  accountRepo: AccountRepoUpdate,
  userId: string,
  accountId: string,
  data: UpdateAccountRequest,
  options: UpdateAccountOptions
): Promise<GetAccountResponse | null> {
  const row = await accountRepo.findOfframpAccountByIdAndUser(accountId, userId);
  if (!row) return null;

  const existing = parseProviderPayout(row.providerPayout);
  if (!existing) {
    throw new Error('INVALID_ACCOUNT: account providerPayout is missing or invalid');
  }

  const mergedDestination = mergePalremitDestination(
    existing.destination,
    data.destination
  );

  let providerPayout;
  try {
    providerPayout = await buildValidatedProviderPayout(
      options.palremitLiquidityRequest,
      existing.corridor,
      mergedDestination
    );
  } catch (e) {
    rethrowPalremitCorridorError(e);
  }

  const updated = await accountRepo.updateAccountProviderPayout(
    accountId,
    userId,
    providerPayout as object
  );
  if (!updated) return null;

  return mapAccountRowToApi(updated, { mask: false });
}
