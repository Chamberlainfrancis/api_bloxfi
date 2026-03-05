/**
 * Core: get single fiat account (full details, no masking). Spec §3.3.
 */

import {
  ACCOUNT_REGION_TYPES,
  type GetAccountResponse,
  type AccountHolder,
  type RegionAccountDetails,
  type RailType,
} from '../../types/account';

export interface AccountRepoGet {
  findAccountByIdAndUser(
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
  const acc: GetAccountResponse = {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rail,
    accountHolder: accountHolder ?? undefined,
  };
  const type = row.accountType;
  if (type && ACCOUNT_REGION_TYPES.includes(type as (typeof ACCOUNT_REGION_TYPES)[number])) {
    (acc as unknown as Record<string, unknown>)[type] = regionDetails;
  }
  return acc;
}

export async function getAccount(
  repo: AccountRepoGet,
  userId: string,
  accountId: string
): Promise<GetAccountResponse | null> {
  const account = await repo.findAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  return rowToAccount(account);
}
