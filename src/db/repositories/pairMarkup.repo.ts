/**
 * PairMarkupSetting repository. Only layer that touches Prisma for it.
 */

import { prisma } from '@/db/prisma/client';
import type { PairMarkupKey, PairMarkupSetting, PairMarkupSide } from '@/core/admin/pairMarkup';

function toSetting(row: {
  id: string;
  fiat: string;
  side: string;
  cryptos: string;
  markupBps: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PairMarkupSetting {
  return { ...row, side: row.side as PairMarkupSide };
}

export async function listPairMarkupSettings(): Promise<PairMarkupSetting[]> {
  const rows = await prisma.pairMarkupSetting.findMany({
    orderBy: [{ fiat: 'asc' }, { side: 'asc' }],
  });
  return rows.map(toSetting);
}

export async function findPairMarkupSettingById(id: string): Promise<PairMarkupSetting | null> {
  const row = await prisma.pairMarkupSetting.findUnique({ where: { id } });
  return row ? toSetting(row) : null;
}

export async function findPairMarkupSettingByKey(key: PairMarkupKey): Promise<PairMarkupSetting | null> {
  const row = await prisma.pairMarkupSetting.findUnique({ where: { fiat_side: key } });
  return row ? toSetting(row) : null;
}

export async function upsertPairMarkupSetting(
  key: PairMarkupKey,
  data: { cryptos: string; markupBps: number; updatedBy: string | null }
): Promise<PairMarkupSetting> {
  const row = await prisma.pairMarkupSetting.upsert({
    where: { fiat_side: key },
    create: { ...key, ...data },
    update: data,
  });
  return toSetting(row);
}

export async function deletePairMarkupSettingById(id: string): Promise<void> {
  await prisma.pairMarkupSetting.delete({ where: { id } });
}
