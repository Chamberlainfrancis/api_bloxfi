/**
 * Offramp repository. Only layer that touches Prisma for Offramp.
 * Per CURSOR_RULES: all DB access for offramps goes through this file.
 */

import { prisma } from '../prisma/client';
import type { OfframpStatus } from '../../types/offramp';

const STATUS_VALUES = [
  'CREATED',
  'AWAITING_CRYPTO',
  'CRYPTO_RECEIVED',
  'FIAT_PENDING',
  'COMPLETED',
  'CANCELLED',
  'CRYPTO_FAILED',
  'FIAT_FAILED',
  'EXPIRED',
] as const;

function toPrismaStatus(s: OfframpStatus): (typeof STATUS_VALUES)[number] {
  if (STATUS_VALUES.includes(s as (typeof STATUS_VALUES)[number])) {
    return s as (typeof STATUS_VALUES)[number];
  }
  return 'CREATED';
}

export interface CreateOfframpData {
  requestId: string;
  userId: string;
  status: OfframpStatus;
  source: object;
  destination: object;
  rateInformation: object;
  depositInstructions?: object | null;
  timeline?: object | null;
  fees?: object | null;
  receipt?: object | null;
  refundDetails?: object | null;
  failedReason?: string | null;
  lpReference?: string | null;
}

export interface OfframpRow {
  id: string;
  requestId: string;
  userId: string;
  status: string;
  source: unknown;
  destination: unknown;
  rateInformation: unknown;
  depositInstructions: unknown;
  timeline: unknown;
  fees: unknown;
  receipt: unknown;
  refundDetails: unknown;
  failedReason: string | null;
  lpReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createOfframp(data: CreateOfframpData): Promise<OfframpRow> {
  const row = await prisma.offramp.create({
    data: {
      requestId: data.requestId,
      userId: data.userId,
      status: toPrismaStatus(data.status as OfframpStatus),
      source: data.source as object,
      destination: data.destination as object,
      rateInformation: data.rateInformation as object,
      depositInstructions: data.depositInstructions as object | undefined,
      timeline: data.timeline as object | undefined,
      fees: data.fees as object | undefined,
      receipt: data.receipt as object | undefined,
      refundDetails: data.refundDetails as object | undefined,
      failedReason: data.failedReason ?? null,
      lpReference: data.lpReference ?? null,
    },
  });
  return row as OfframpRow;
}

export async function findOfframpById(id: string): Promise<OfframpRow | null> {
  const row = await prisma.offramp.findUnique({
    where: { id },
  });
  return row as OfframpRow | null;
}

export async function findOfframpByRequestId(requestId: string): Promise<OfframpRow | null> {
  const row = await prisma.offramp.findUnique({
    where: { requestId },
  });
  return row as OfframpRow | null;
}

export async function updateOfframpStatus(
  id: string,
  status: OfframpStatus,
  updates?: {
    depositInstructions?: object | null;
    timeline?: object | null;
    fees?: object | null;
    receipt?: object | null;
    refundDetails?: object | null;
    failedReason?: string | null;
  }
): Promise<OfframpRow | null> {
  const row = await prisma.offramp.update({
    where: { id },
    data: {
      status: toPrismaStatus(status),
      ...(updates?.depositInstructions !== undefined && {
        depositInstructions: updates.depositInstructions as object | undefined,
      }),
      ...(updates?.timeline !== undefined && { timeline: updates.timeline as object | undefined }),
      ...(updates?.fees !== undefined && { fees: updates.fees as object | undefined }),
      ...(updates?.receipt !== undefined && { receipt: updates.receipt as object | undefined }),
      ...(updates?.refundDetails !== undefined && {
        refundDetails: updates.refundDetails as object | undefined,
      }),
      ...(updates?.failedReason !== undefined && { failedReason: updates.failedReason }),
    },
  });
  return row as OfframpRow;
}

export interface ListOfframpsParams {
  userId?: string;
  status?: OfframpStatus;
  currency?: string;
  limit: number;
  createdBefore?: Date;
  createdAfter?: Date;
}

export async function listOfframps(params: ListOfframpsParams): Promise<{
  offramps: OfframpRow[];
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

  let rows = await prisma.offramp.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: currency ? take * 3 : take + 1,
  });

  if (currency) {
    const lower = currency.toLowerCase();
    rows = rows.filter(
      (r: { source: unknown; destination: unknown }) =>
        (r.source as { currency?: string })?.currency?.toLowerCase() === lower ||
        (r.destination as { currency?: string })?.currency?.toLowerCase() === lower
    );
  }

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].createdAt : null;
  return {
    offramps: page as OfframpRow[],
    nextCursor,
  };
}
