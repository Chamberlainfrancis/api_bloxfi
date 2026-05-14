/**
 * Core: get single offramp payout account (full details, no masking). Spec §3.3.
 */

import type { GetAccountResponse, AccountHolder, RegionAccountDetails, RailType } from '@/types/account';

export interface AccountRepoGet {
  findOfframpAccountByIdAndUser(
    accountId: string,
    userId: string
  ): Promise<{
    id: string;
    userId: string;
    railType: string;
    currency: string;
    paymentRail: string;
    accountType: string;
    accountHolder: unknown;
    regionDetails: unknown;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
}

function rowToAccount(row: {
  id: string;
  userId: string;
  railType: string;
  currency: string;
  paymentRail: string;
  accountType: string;
  accountHolder: unknown;
  regionDetails: unknown;
  createdAt: Date;
  updatedAt: Date;
}): GetAccountResponse {
  const rail = {
    currency: row.currency,
    railType: row.railType as RailType,
    paymentRail: row.paymentRail,
  };
  const accountHolder = row.accountHolder as AccountHolder | null;
  const regionDetails = row.regionDetails as RegionAccountDetails | null;
  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rail,
    type: row.accountType,
    details: regionDetails,
    accountHolder: accountHolder ?? undefined,
  };
}

export async function getAccount(
  repo: AccountRepoGet,
  userId: string,
  accountId: string
): Promise<GetAccountResponse | null> {
  const account = await repo.findOfframpAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  return rowToAccount(account);
}
