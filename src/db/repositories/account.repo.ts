/**
 * Fiat account repository (offramp payout destinations). Only layer that touches Prisma for Account.
 * Per CURSOR_RULES: all DB access for accounts goes through this file.
 */

import { prisma } from "@/db/prisma/client";
import { Prisma } from "@/generated/prisma/client";
import type { RailType } from "@/types/account";
import { maybeScheduleAccountCapabilitiesUpdated } from "@/core/partnerWebhooks/capabilities";

export interface CreateAccountData {
  userId: string;
  railType: RailType;
  currency?: string | null;
  paymentRail?: string | null;
  accountType: string;
  accountHolder: object;
  providerPayout?: object | null;
  swipeluxCustomerId?: string | null;
  kycImportStatus?: string | null;
  creationRequestId?: string | null;
  sofQuestionnaire?: object | null;
  sourceOfFundsDocumentPath?: string | null;
  metadata?: object | null;
  providerIssuanceStatus?: string | null;
  provisionedAccountId?: string | null;
  depositDetails?: object | null;
  providerIssuanceFailureReason?: string | null;
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
  swipeluxCustomerId: string | null;
  kycImportStatus: string | null;
  creationRequestId: string | null;
  sofQuestionnaire: unknown;
  sourceOfFundsDocumentPath: string | null;
  metadata: unknown;
  providerIssuanceStatus: string | null;
  provisionedAccountId: string | null;
  depositDetails: unknown;
  providerIssuanceFailureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createAccount(data: CreateAccountData): Promise<AccountRow> {
  const account = await prisma.account.create({
    data: {
      userId: data.userId,
      railType: data.railType,
      currency: data.currency ?? undefined,
      paymentRail: data.paymentRail ?? undefined,
      accountType: data.accountType,
      accountHolder: data.accountHolder as object,
      providerPayout: data.providerPayout != null ? (data.providerPayout as object) : undefined,
      swipeluxCustomerId: data.swipeluxCustomerId ?? undefined,
      kycImportStatus: data.kycImportStatus ?? undefined,
      creationRequestId: data.creationRequestId ?? undefined,
      sofQuestionnaire: data.sofQuestionnaire != null ? (data.sofQuestionnaire as object) : undefined,
      sourceOfFundsDocumentPath: data.sourceOfFundsDocumentPath ?? undefined,
      metadata: data.metadata != null ? (data.metadata as object) : undefined,
      providerIssuanceStatus: data.providerIssuanceStatus ?? undefined,
      provisionedAccountId: data.provisionedAccountId ?? undefined,
      depositDetails: data.depositDetails != null ? (data.depositDetails as object) : undefined,
      providerIssuanceFailureReason: data.providerIssuanceFailureReason ?? undefined,
    },
  });
  return account as AccountRow;
}

export async function findAccountById(accountId: string): Promise<AccountRow | null> {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  return account as AccountRow | null;
}

export async function findAccountByProvisionedAccountId(
  provisionedAccountId: string
): Promise<AccountRow | null> {
  const account = await prisma.account.findFirst({
    where: { provisionedAccountId },
  });
  return account as AccountRow | null;
}

export async function updateAccountProviderIssuance(
  accountId: string,
  patch: {
    providerIssuanceStatus: string;
    provisionedAccountId?: string | null;
    depositDetails?: object | null;
    providerIssuanceFailureReason?: string | null;
  }
): Promise<AccountRow> {
  const before = await prisma.account.findUnique({ where: { id: accountId } });
  const data: Prisma.AccountUpdateInput = {
    providerIssuanceStatus: patch.providerIssuanceStatus,
  };
  if (patch.provisionedAccountId !== undefined) {
    data.provisionedAccountId = patch.provisionedAccountId;
  }
  if (patch.depositDetails !== undefined) {
    data.depositDetails =
      patch.depositDetails === null
        ? Prisma.DbNull
        : (patch.depositDetails as Prisma.InputJsonValue);
  }
  if (patch.providerIssuanceFailureReason !== undefined) {
    data.providerIssuanceFailureReason = patch.providerIssuanceFailureReason;
  }
  const account = await prisma.account.update({
    where: { id: accountId },
    data,
  });
  maybeScheduleAccountCapabilitiesUpdated(before ?? {}, account as AccountRow);
  return account as AccountRow;
}

/**
 * Soft-replay on creationRequestId, mirroring user.repo.ts's createUser/userCreationPayloadsMatch
 * (NOT onramp.repo.ts's createOnramp, which has no such function and relies on a hard controller-level
 * 409). Onramp callers look this up before calling accountRepo.createAccount to decide whether to
 * short-circuit and return the existing row instead of re-calling liquidity.
 */
export async function findAccountByCreationRequestId(requestId: string): Promise<AccountRow | null> {
  const account = await prisma.account.findUnique({
    where: { creationRequestId: requestId },
  });
  return account as AccountRow | null;
}

/**
 * Rail-agnostic lookup — unlike findOfframpAccountByIdAndUser (which hardcodes `railType: "offramp"`
 * and would incorrectly 404 an onramp row), this matches any rail.
 */
export async function findAccountByIdAndUser(accountId: string, userId: string): Promise<AccountRow | null> {
  const account = await prisma.account.findFirst({
    where: { id: accountId, userId },
  });
  return account as AccountRow | null;
}

/**
 * Onramp rows for a user, oldest first. Used to infer which account a USD
 * onramp belongs to, since the onramp request itself is user-scoped and
 * carries no account id. Nothing constrains a user to one onramp account, so
 * callers must handle zero and many.
 */
export async function findOnrampAccountsByUser(userId: string): Promise<AccountRow[]> {
  const accounts = await prisma.account.findMany({
    where: { userId, railType: 'onramp' },
    orderBy: { createdAt: 'asc' },
  });
  return accounts as AccountRow[];
}

export async function updateAccountKycImport(
  accountId: string,
  patch: { kycImportStatus: string; swipeluxCustomerId?: string | null }
): Promise<AccountRow> {
  const account = await prisma.account.update({
    where: { id: accountId },
    data: {
      kycImportStatus: patch.kycImportStatus,
      ...(patch.swipeluxCustomerId !== undefined && { swipeluxCustomerId: patch.swipeluxCustomerId }),
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
  // Rail-agnostic: onramp rows are deletable too (Task 7). Using the offramp-only lookup here
  // would silently 404 an onramp row even after the core layer's existence check passed.
  const account = await findAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  await prisma.account.delete({
    where: { id: accountId },
  });
  return { id: accountId };
}

export async function updateAccountProviderPayout(
  accountId: string,
  userId: string,
  providerPayout: object
): Promise<AccountRow | null> {
  const account = await findOfframpAccountByIdAndUser(accountId, userId);
  if (!account) return null;
  const updated = await prisma.account.update({
    where: { id: accountId },
    data: { providerPayout: providerPayout as object },
  });
  return updated as AccountRow;
}

/**
 * Whether the account has pending transactions (onramp/offramp).
 * When Feature 5/6 exist, query those tables. Until then, no pending.
 */
export async function hasPendingTransactions(_accountId: string): Promise<boolean> {
  return false;
}
