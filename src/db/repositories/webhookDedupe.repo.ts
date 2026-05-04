/**
 * Idempotency ledger for inbound webhooks: first delivery wins; replays return duplicate.
 */

import { prisma } from '@/db/prisma/client';

export async function tryClaimWebhookDedupe(provider: string, dedupeKey: string): Promise<boolean> {
  try {
    await prisma.webhookDedupe.create({
      data: {
        provider,
        dedupeKey,
      },
    });
    return true;
  } catch (e: unknown) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as { code?: string }).code : undefined;
    if (code === 'P2002') return false;
    throw e;
  }
}
