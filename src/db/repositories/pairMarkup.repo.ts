/**
 * PairMarkupSetting repository. Only layer that touches Prisma for it.
 */

import { prisma } from '@/db/prisma/client';
import type { Prisma } from '@/generated/prisma/client';
import type {
  PairMarkupKey,
  PairMarkupSetting,
  PairMarkupSide,
  PairMarkupWriteData,
  PairMarkupWriteTx,
} from '@/core/admin/pairMarkup';

// pg advisory lock id for PairMarkupSetting writes ("PMKS" in hex).
const WRITE_LOCK_ID = 0x504d4b53;

function toSetting(row: {
  id: string;
  fiat: string;
  side: string;
  cryptos: string;
  markupBps: number;
  requireProviderRate: boolean;
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

export async function deletePairMarkupSettingById(id: string): Promise<void> {
  await prisma.pairMarkupSetting.delete({ where: { id } });
}

export async function listRecentOfframpCurrencies(since: Date): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ currency: string | null }>>`
    SELECT DISTINCT UPPER(TRIM("destination"->>'currency')) AS currency
    FROM "Offramp"
    WHERE "createdAt" >= ${since} AND "destination"->>'currency' IS NOT NULL
  `;
  return rows.map((r) => r.currency).filter((c): c is string => Boolean(c));
}

function writeTx(db: Prisma.TransactionClient): PairMarkupWriteTx {
  return {
    async listPairMarkupSettingsForKey(key: PairMarkupKey) {
      const rows = await db.pairMarkupSetting.findMany({ where: key, orderBy: { createdAt: 'asc' } });
      return rows.map(toSetting);
    },
    async findPairMarkupSettingById(id: string) {
      const row = await db.pairMarkupSetting.findUnique({ where: { id } });
      return row ? toSetting(row) : null;
    },
    async createPairMarkupSetting(key: PairMarkupKey, data: PairMarkupWriteData) {
      return toSetting(await db.pairMarkupSetting.create({ data: { ...key, ...data } }));
    },
    async updatePairMarkupSetting(id: string, data: Partial<PairMarkupWriteData>) {
      return toSetting(await db.pairMarkupSetting.update({ where: { id }, data }));
    },
    async deletePairMarkupSettingById(id: string) {
      await db.pairMarkupSetting.delete({ where: { id } });
    },
  };
}

/**
 * One transaction holding a table-wide advisory lock, so two dashboard saves
 * can't both give the same coin to different rows.
 */
export async function withPairMarkupWriteLock<T>(fn: (tx: PairMarkupWriteTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (db) => {
    await db.$executeRaw`SELECT pg_advisory_xact_lock(${WRITE_LOCK_ID})`;
    return fn(writeTx(db));
  });
}
