/**
 * Audit log for inbound LP webhooks (POST /api/v1/webhooks).
 */

import { prisma } from '@/db/prisma/client';

const MAX_RAW_BODY_CHARS = 512_000;

export type WebhookInboundOutcome =
  | 'invalid_buffer'
  | 'bad_signature'
  | 'bad_json'
  | 'bad_schema'
  | 'processed'
  | 'handler_error';

export function truncateWebhookRawBody(raw: string): string {
  if (raw.length <= MAX_RAW_BODY_CHARS) return raw;
  return `${raw.slice(0, MAX_RAW_BODY_CHARS)}\n…[truncated ${raw.length - MAX_RAW_BODY_CHARS} chars]`;
}

export async function createWebhookInboundLog(data: {
  rawBody: string;
  outcome: WebhookInboundOutcome;
  eventType?: string | null;
  eventId?: string | null;
  payload?: unknown | null;
  errorMessage?: string | null;
}): Promise<void> {
  await prisma.webhookInboundLog.create({
    data: {
      rawBody: data.rawBody,
      outcome: data.outcome,
      eventType: data.eventType ?? null,
      eventId: data.eventId ?? null,
      payload:
        data.payload !== undefined && data.payload !== null
          ? (JSON.parse(JSON.stringify(data.payload)) as object)
          : undefined,
      errorMessage: data.errorMessage ?? null,
    },
  });
}

/** Delete rows older than the given date (e.g. 4 months ago). */
export async function deleteWebhookInboundLogsReceivedBefore(cutoff: Date): Promise<number> {
  const result = await prisma.webhookInboundLog.deleteMany({
    where: { receivedAt: { lt: cutoff } },
  });
  return result.count;
}
