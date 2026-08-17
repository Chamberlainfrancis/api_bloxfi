/**
 * Audit log for outbound partner webhooks (PARTNER_WEBHOOK_URL).
 */

import { prisma } from '@/db/prisma/client';
import { truncateWebhookRawBody } from '@/db/repositories/webhookInboundLog.repo';

export type WebhookOutboundOutcome =
  | 'pending'
  | 'skipped_no_url'
  | 'skipped_no_secret'
  | 'delivered'
  | 'failed';

export async function createWebhookOutboundLog(data: {
  eventId: string;
  eventType: string;
  payload: unknown;
  rawBody: string;
  destination?: string | null;
  outcome?: WebhookOutboundOutcome;
}): Promise<string> {
  const row = await prisma.webhookOutboundLog.create({
    data: {
      eventId: data.eventId,
      eventType: data.eventType,
      payload: JSON.parse(JSON.stringify(data.payload)) as object,
      rawBody: truncateWebhookRawBody(data.rawBody),
      destination: data.destination ?? null,
      outcome: data.outcome ?? 'pending',
    },
    select: { id: true },
  });
  return row.id;
}

export async function updateWebhookOutboundLog(
  id: string,
  patch: {
    outcome: WebhookOutboundOutcome;
    attempts?: number;
    httpStatus?: number | null;
    errorMessage?: string | null;
    destination?: string | null;
    deliveredAt?: Date | null;
  }
): Promise<void> {
  await prisma.webhookOutboundLog.update({
    where: { id },
    data: {
      outcome: patch.outcome,
      ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
      ...(patch.httpStatus !== undefined ? { httpStatus: patch.httpStatus } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
      ...(patch.destination !== undefined ? { destination: patch.destination } : {}),
      ...(patch.deliveredAt !== undefined ? { deliveredAt: patch.deliveredAt } : {}),
    },
  });
}

export async function deleteWebhookOutboundLogsCreatedBefore(cutoff: Date): Promise<number> {
  const result = await prisma.webhookOutboundLog.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return result.count;
}
