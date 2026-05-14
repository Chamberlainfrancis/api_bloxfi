/**
 * Core: list offramp payout accounts with cursor pagination and filters. Mask account numbers in list. Spec §3.2.
 */

import type { ListAccountsQuery, ListAccountsResponse, Account, RailInfo, AccountHolder, RegionAccountDetails, RailType } from '@/types/account';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MASK_CHARS = 4;

function maskAccountNumber(value: string | null | undefined): string | null | undefined {
  if (value == null || value === '') return value;
  const s = String(value).trim();
  if (s.length <= MASK_CHARS) return '****';
  return '*'.repeat(s.length - MASK_CHARS) + s.slice(-MASK_CHARS);
}

/** Mask sensitive fields in region details for list response */
function maskRegionDetails(details: unknown): RegionAccountDetails | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const out: Record<string, unknown> = { ...d };
  if (d.accountNumber != null) out.accountNumber = maskAccountNumber(String(d.accountNumber));
  if (d.routingNumber != null) out.routingNumber = maskAccountNumber(String(d.routingNumber));
  if (d.bankCode != null) out.bankCode = maskAccountNumber(String(d.bankCode));
  if (d.bank_code != null) out.bank_code = maskAccountNumber(String(d.bank_code));
  return out as unknown as RegionAccountDetails;
}

function rowToAccount(
  row: {
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
  },
  options: { mask: boolean }
): Account {
  const rail: RailInfo = {
    currency: row.currency,
    railType: row.railType as RailType,
    paymentRail: row.paymentRail,
  };
  const accountHolder = row.accountHolder as AccountHolder | null;
  const regionDetails = options.mask
    ? maskRegionDetails(row.regionDetails)
    : (row.regionDetails as RegionAccountDetails | null);

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
    accounts: Array<{
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
    }>;
    nextCursor: Date | null;
  }>;
}

export async function listAccounts(
  repo: AccountRepoList,
  userId: string,
  query: ListAccountsQuery
): Promise<ListAccountsResponse> {
  const limit = Math.min(
    Math.max(1, query.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT
  );
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

  return {
    count: accounts.length,
    banks: accounts.map((row) => rowToAccount(row, { mask: true })),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}
