/**
 * SenderInfoSetting repository. Only layer that touches Prisma for it.
 */

import { prisma } from '@/db/prisma/client';
import type {
  SenderInfoKey,
  SenderInfoRampType,
  SenderInfoSetting,
} from '@/core/admin/senderInfo';

function toSetting(row: {
  id: string;
  rampType: string;
  currency: string;
  rail: string;
  senderName: string;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}): SenderInfoSetting {
  return { ...row, rampType: row.rampType as SenderInfoRampType };
}

export async function listSenderInfoSettings(): Promise<SenderInfoSetting[]> {
  const rows = await prisma.senderInfoSetting.findMany({
    orderBy: [{ rampType: 'asc' }, { currency: 'asc' }, { rail: 'asc' }],
  });
  return rows.map(toSetting);
}

export async function findSenderInfoSettingsForCurrency(
  rampType: SenderInfoRampType,
  currency: string
): Promise<SenderInfoSetting[]> {
  const rows = await prisma.senderInfoSetting.findMany({ where: { rampType, currency } });
  return rows.map(toSetting);
}

export async function findSenderInfoSettingById(id: string): Promise<SenderInfoSetting | null> {
  const row = await prisma.senderInfoSetting.findUnique({ where: { id } });
  return row ? toSetting(row) : null;
}

export async function findSenderInfoSettingByKey(key: SenderInfoKey): Promise<SenderInfoSetting | null> {
  const row = await prisma.senderInfoSetting.findUnique({ where: { rampType_currency_rail: key } });
  return row ? toSetting(row) : null;
}

export async function upsertSenderInfoSetting(
  key: SenderInfoKey,
  data: { senderName: string; updatedBy: string | null }
): Promise<SenderInfoSetting> {
  const row = await prisma.senderInfoSetting.upsert({
    where: { rampType_currency_rail: key },
    create: { ...key, ...data },
    update: data,
  });
  return toSetting(row);
}

export async function deleteSenderInfoSettingById(id: string): Promise<void> {
  await prisma.senderInfoSetting.delete({ where: { id } });
}
