/**
 * Core: get single account (offramp payout or onramp KYC-import), full details, no masking. Spec §3.3.
 */

import { mapAccountRowToApi, type AccountRowLike } from '@/core/accounts/mapAccountRow';
import type { GetAccountResponse } from '@/types/account';

export interface AccountRepoGet {
  findAccountByIdAndUser(
    accountId: string,
    userId: string
  ): Promise<AccountRowLike | null>;
}

export async function getAccount(
  repo: AccountRepoGet,
  userId: string,
  accountId: string,
  options?: { graphUsdEligible?: boolean }
): Promise<GetAccountResponse | null> {
  const account = await repo.findAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  return mapAccountRowToApi(account, {
    mask: false,
    graphUsdEligible: options?.graphUsdEligible === true,
  });
}
