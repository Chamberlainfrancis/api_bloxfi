/**
 * AdminAction repository. Only layer that touches Prisma for AdminAction.
 * Records manual status changes made via the no-auth admin dashboard.
 */

import { prisma } from '@/db/prisma/client';

export interface CreateAdminActionData {
  txnType: 'onramp' | 'offramp';
  txnId: string;
  fromStatus: string;
  toStatus: string;
  note?: string | null;
  actor?: string | null;
}

export interface AdminActionRow {
  id: string;
  txnType: string;
  txnId: string;
  fromStatus: string;
  toStatus: string;
  note: string | null;
  actor: string | null;
  createdAt: Date;
}

export async function createAdminAction(data: CreateAdminActionData): Promise<AdminActionRow> {
  const row = await prisma.adminAction.create({
    data: {
      txnType: data.txnType,
      txnId: data.txnId,
      fromStatus: data.fromStatus,
      toStatus: data.toStatus,
      note: data.note ?? null,
      actor: data.actor ?? null,
    },
  });
  return row as AdminActionRow;
}

export async function listAdminActionsForTxn(
  txnType: string,
  txnId: string
): Promise<AdminActionRow[]> {
  const rows = await prisma.adminAction.findMany({
    where: { txnType, txnId },
    orderBy: { createdAt: 'desc' },
  });
  return rows as AdminActionRow[];
}
