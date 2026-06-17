/**
 * Fiat account repository (offramp payout destinations). Only layer that touches Prisma for Account.
 * Per CURSOR_RULES: all DB access for accounts goes through this file.
 */

import { prisma } from "@/db/prisma/client";
import type { RailType } from "@/types/account";

export interface CreateAccountData {
  userId: string;
  railType: RailType;
  currency: string;
  paymentRail: string;
  accountType: string;
  accountHolder: object;
  providerPayout: object;
}

export interface AccountRow {
  id: string;
  userId: string;
  railType: string;
  currency: string;
  paymentRail: string;
  accountType: string;
  accountHolder: unknown;
  providerPayout: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export async function createAccount(data: CreateAccountData): Promise<AccountRow> {
  const account = await prisma.account.create({
    data: {
      userId: data.userId,
      railType: data.railType,
      currency: data.currency,
      paymentRail: data.paymentRail,
      accountType: data.accountType,
      accountHolder: data.accountHolder as object,
      providerPayout: data.providerPayout as object,
    },
  });
  return account as AccountRow;
}

/** Fiat payout bank rows for offramps only (not used for onramp). */
export async function findOfframpAccountByIdAndUser(accountId: string, userId: string): Promise<AccountRow | null> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId, railType: "offramp" },
  });
  return account as AccountRow | null;
}

/** Batch lookup for the admin dashboard list view (resolves beneficiary names for many rows at once). */
export async function findAccountsByIds(accountIds: string[]): Promise<AccountRow[]> {
  if (!accountIds.length) return [];
  const accounts = await prisma.account.findMany({
    where: { id: { in: accountIds } },
  });
  return accounts as AccountRow[];
}

export interface ListAccountsParams {
  userId: string;
  limit: number;
  createdBefore?: Date;
  createdAfter?: Date;
  rail?: RailType;
  type?: string;
  currency?: string;
}

export async function listAccounts(params: ListAccountsParams): Promise<{
  accounts: AccountRow[];
  nextCursor: Date | null;
}> {
  const { userId, limit, createdBefore, createdAfter, rail, type, currency } = params;
  const take = Math.min(Math.max(1, limit), 100);
  const where: {
    userId: string;
    railType: string;
    createdAt?: { lt?: Date; gt?: Date };
    accountType?: string;
    currency?: string;
  } = { userId, railType: rail ?? "offramp" };

  if (createdBefore) {
    where.createdAt = { ...where.createdAt, lt: createdBefore };
  }
  if (createdAfter) {
    where.createdAt = { ...where.createdAt, gt: createdAfter };
  }
  if (createdBefore && createdAfter) {
    where.createdAt = { lt: createdBefore, gt: createdAfter };
  }
  if (type) where.accountType = type;
  if (currency) where.currency = currency;

  const rows = await prisma.account.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: take + 1,
  });
  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].createdAt : null;
  return {
    accounts: page as AccountRow[],
    nextCursor,
  };
}

export async function deleteAccount(accountId: string, userId: string): Promise<{ id: string } | null> {
  const account = await findOfframpAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  await prisma.account.delete({
    where: { id: accountId },
  });
  return { id: accountId };
}

/**
 * Whether the account has pending transactions (onramp/offramp).
 * When Feature 5/6 exist, query those tables. Until then, no pending.
 */
export async function hasPendingTransactions(_accountId: string): Promise<boolean> {
  return false;
}
