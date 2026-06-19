/**
 * Ramp quote repository. All DB access for RampQuote.
 */

import { prisma } from '@/db/prisma/client';
import type { OfframpQuoteSnapshot, OnrampQuoteSnapshot } from '@/types/quote';

export type RampQuoteType = 'offramp' | 'onramp';

export async function createRampQuote(params: {
  rampType: RampQuoteType;
  payload: OfframpQuoteSnapshot | OnrampQuoteSnapshot;
  expiresAt: Date;
}): Promise<{ id: string; expiresAt: Date }> {
  const row = await prisma.rampQuote.create({
    data: {
      rampType: params.rampType,
      payload: params.payload as object,
      expiresAt: params.expiresAt,
    },
    select: { id: true, expiresAt: true },
  });
  return row;
}

export async function consumeRampQuote<T extends OfframpQuoteSnapshot | OnrampQuoteSnapshot>(
  quoteId: string,
  rampType: RampQuoteType
): Promise<T | null> {
  const now = new Date();
  const row = await prisma.rampQuote.findUnique({ where: { id: quoteId } });
  if (!row || row.rampType !== rampType) return null;
  if (row.consumedAt != null) return null;
  if (row.expiresAt <= now) return null;

  const updated = await prisma.rampQuote.updateMany({
    where: { id: quoteId, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (updated.count !== 1) return null;
  return row.payload as unknown as T;
}

export async function findRampQuoteById(quoteId: string): Promise<{
  rampType: RampQuoteType;
  payload: unknown;
  expiresAt: Date;
  consumedAt: Date | null;
} | null> {
  const row = await prisma.rampQuote.findUnique({ where: { id: quoteId } });
  if (!row) return null;
  return {
    rampType: row.rampType as RampQuoteType,
    payload: row.payload,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
  };
}
