/**
 * Onramp repository. Only layer that touches Prisma for Onramp.
 * Per CURSOR_RULES: all DB access for onramps goes through this file.
 */

import { prisma } from '../prisma/client';
import type { OnrampStatus } from '../../types/onramp';

// Map our status type to Prisma enum (same string values).
const STATUS_VALUES = [
  'CREATED', 'AWAITING_FUNDS', 'FIAT_PENDING', 'FIAT_PROCESSED',
  'CRYPTO_INITIATED', 'CRYPTO_PENDING', 'COMPLETED', 'FIAT_FAILED',
  'FIAT_RETURNED', 'CRYPTO_FAILED', 'EXPIRED',
] as const;

function toPrismaStatus(s: OnrampStatus): (typeof STATUS_VALUES)[number] {
  if (STATUS_VALUES.includes(s as (typeof STATUS_VALUES)[number])) {
    return s as (typeof STATUS_VALUES)[number];
  }
  return 'CREATED';
}

export interface CreateOnrampData {
  requestId: string;
  userId: string;
  status: OnrampStatus;
  source: object;
  destination: object;
  quoteInformation: object;
  depositInfo?: object | null;
  receipt?: object | null;
  developerFee?: object | null;
  failedReason?: string | null;
}

export interface OnrampRow {
  id: string;
  requestId: string;
  userId: string;
  status: string;
  source: unknown;
  destination: unknown;
  quoteInformation: unknown;
  depositInfo: unknown;
  receipt: unknown;
  developerFee: unknown;
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createOnramp(data: CreateOnrampData): Promise<OnrampRow> {
  const row = await prisma.onramp.create({
    data: {
      requestId: data.requestId,
      userId: data.userId,
      status: toPrismaStatus(data.status as OnrampStatus),
      source: data.source as object,
      destination: data.destination as object,
      quoteInformation: data.quoteInformation as object,
      depositInfo: data.depositInfo as object | undefined,
      receipt: data.receipt as object | undefined,
      developerFee: data.developerFee as object | undefined,
      failedReason: data.failedReason ?? null,
    },
  });
  return row as OnrampRow;
}

export async function findOnrampById(id: string): Promise<OnrampRow | null> {
  const row = await prisma.onramp.findUnique({
    where: { id },
  });
  return row as OnrampRow | null;
}

export async function findOnrampByRequestId(requestId: string): Promise<OnrampRow | null> {
  const row = await prisma.onramp.findUnique({
    where: { requestId },
  });
  return row as OnrampRow | null;
}

export async function updateOnrampStatus(
  id: string,
  status: OnrampStatus,
  updates?: { receipt?: object | null; failedReason?: string | null }
): Promise<OnrampRow | null> {
  const row = await prisma.onramp.update({
    where: { id },
    data: {
      status: toPrismaStatus(status),
      ...(updates?.receipt !== undefined && { receipt: updates.receipt as object | undefined }),
      ...(updates?.failedReason !== undefined && { failedReason: updates.failedReason }),
    },
  });
  return row as OnrampRow;
}

export interface ListOnrampsParams {
  userId?: string;
  status?: OnrampStatus;
  currency?: string;
  limit: number;
  createdBefore?: Date;
  createdAfter?: Date;
}

export async function listOnramps(params: ListOnrampsParams): Promise<{
  onramps: OnrampRow[];
  nextCursor: Date | null;
}> {
  const { userId, status, currency, limit, createdBefore, createdAfter } = params;
  const take = Math.min(Math.max(1, limit), 100);
  const where: {
    userId?: string;
    status?: (typeof STATUS_VALUES)[number];
    createdAt?: { lt?: Date; gt?: Date };
  } = {};

  if (userId) where.userId = userId;
  if (status) where.status = toPrismaStatus(status);
  if (createdBefore || createdAfter) {
    where.createdAt = {};
    if (createdBefore) where.createdAt.lt = createdBefore;
    if (createdAfter) where.createdAt.gt = createdAfter;
  }

  let rows = await prisma.onramp.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: currency ? take * 3 : take + 1, // fetch extra if filtering by currency in memory
  });

  if (currency) {
    const lower = currency.toLowerCase();
    rows = rows.filter((r) => (r.source as { currency?: string })?.currency?.toLowerCase() === lower);
  }

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].createdAt : null;
  return {
    onramps: page as OnrampRow[],
    nextCursor,
  };
}
