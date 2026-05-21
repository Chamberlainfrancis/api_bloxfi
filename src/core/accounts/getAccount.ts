/**
 * Core: get single offramp payout account (full details, no masking). Spec §3.3.
 */

import { mapAccountRowToApi, type AccountRowLike } from '@/core/accounts/mapAccountRow';
import type { GetAccountResponse } from '@/types/account';

export interface AccountRepoGet {
  findOfframpAccountByIdAndUser(
    accountId: string,
    userId: string
  ): Promise<AccountRowLike | null>;
}

export async function getAccount(
  repo: AccountRepoGet,
  userId: string,
  accountId: string
): Promise<GetAccountResponse | null> {
  const account = await repo.findOfframpAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  return mapAccountRowToApi(account, { mask: false });
}
