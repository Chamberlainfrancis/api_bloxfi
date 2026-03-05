/**
 * High-value request repository. Only layer that touches Prisma for HighValueRequest.
 */

import { prisma } from '../prisma/client';
import type { HighValueRequestStatus } from '../../types/limits';

const STATUS_VALUES = ['pending', 'under_review', 'approved', 'rejected'] as const;

function toPrismaStatus(s: HighValueRequestStatus): (typeof STATUS_VALUES)[number] {
  if (STATUS_VALUES.includes(s as (typeof STATUS_VALUES)[number])) {
    return s as (typeof STATUS_VALUES)[number];
  }
  return 'pending';
}

export interface CreateHighValueRequestData {
  requestId: string;
  userId: string;
  status: HighValueRequestStatus;
  currency?: string | null;
  requestedLimit?: string | null;
  reason?: string | null;
}

export interface HighValueRequestRow {
  id: string;
  requestId: string;
  userId: string;
  status: string;
  currency: string | null;
  requestedLimit: string | null;
  reason: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function createHighValueRequest(
  data: CreateHighValueRequestData
): Promise<HighValueRequestRow> {
  const row = await prisma.highValueRequest.create({
    data: {
      requestId: data.requestId,
      userId: data.userId,
      status: toPrismaStatus(data.status),
      currency: data.currency ?? null,
      requestedLimit: data.requestedLimit ?? null,
      reason: data.reason ?? null,
    },
  });
  return row as HighValueRequestRow;
}

export async function findHighValueRequestByRequestId(
  requestId: string
): Promise<HighValueRequestRow | null> {
  const row = await prisma.highValueRequest.findUnique({
    where: { requestId },
  });
  return row as HighValueRequestRow | null;
}

export async function findHighValueRequestById(
  id: string
): Promise<HighValueRequestRow | null> {
  const row = await prisma.highValueRequest.findUnique({
    where: { id },
  });
  return row as HighValueRequestRow | null;
}

export async function updateHighValueRequestStatus(
  id: string,
  status: HighValueRequestStatus
): Promise<HighValueRequestRow | null> {
  const row = await prisma.highValueRequest.update({
    where: { id },
    data: {
      status: toPrismaStatus(status),
      ...(status === 'approved' || status === 'rejected' ? { reviewedAt: new Date() } : {}),
    },
  });
  return row as HighValueRequestRow;
}
