/**
 * Core: list offramp payout accounts with cursor pagination and filters. Mask account numbers in list. Spec §3.2.
 */

import { mapAccountRowToApi, type AccountRowLike } from '@/core/accounts/mapAccountRow';
import type { ListAccountsQuery, ListAccountsResponse, RailType } from '@/types/account';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

export interface AccountRepoList {
  listAccounts(params: {
    userId: string;
    limit: number;
    createdBefore?: Date;
    createdAfter?: Date;
    rail?: RailType;
    type?: string;
    currency?: string;
  }): Promise<{
    accounts: AccountRowLike[];
    nextCursor: Date | null;
  }>;
}

export async function listAccounts(
  repo: AccountRepoList,
  userId: string,
  query: ListAccountsQuery,
  options?: { graphUsdEligible?: boolean }
): Promise<ListAccountsResponse> {
  const limit = Math.min(Math.max(1, query.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const createdBefore = query.createdBefore ? new Date(query.createdBefore) : undefined;
  const createdAfter = query.createdAfter ? new Date(query.createdAfter) : undefined;
  if (createdBefore && isNaN(createdBefore.getTime())) {
    throw new Error('INVALID_CURSOR: createdBefore must be valid ISO 8601');
  }
  if (createdAfter && isNaN(createdAfter.getTime())) {
    throw new Error('INVALID_CURSOR: createdAfter must be valid ISO 8601');
  }

  const { accounts, nextCursor } = await repo.listAccounts({
    userId,
    limit,
    createdBefore,
    createdAfter,
    rail: query.rail,
    type: query.type,
    currency: query.currency,
  });

  const graphUsdEligible = options?.graphUsdEligible === true;
  return {
    count: accounts.length,
    banks: accounts.map((row) =>
      mapAccountRowToApi(row, { mask: true, graphUsdEligible })
    ),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}
