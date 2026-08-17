import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { PartnerWebhookEventType } from '@/types/partnerWebhook';
import {
  dispatchPartnerWebhook,
  type DispatchOpts,
  type DispatchResult,
} from '@/core/partnerWebhooks/dispatch';

export type OutboundWebhookStore = {
  createPending(input: {
    eventId: string;
    eventType: string;
    payload: Record<string, unknown>;
    rawBody: string;
    destination: string | null;
  }): Promise<string | null>;
  finalize(
    id: string,
    result: DispatchResult & { destination: string | null }
  ): Promise<void>;
};

const defaultStore: OutboundWebhookStore = {
  async createPending(input) {
    const { createWebhookOutboundLog } = await import('@/db/repositories/webhookOutboundLog.repo');
    return createWebhookOutboundLog({
      eventId: input.eventId,
      eventType: input.eventType,
      payload: input.payload,
      rawBody: input.rawBody,
      destination: input.destination,
      outcome: 'pending',
    });
  },
  async finalize(id, result) {
    const { updateWebhookOutboundLog } = await import('@/db/repositories/webhookOutboundLog.repo');
    await updateWebhookOutboundLog(id, {
      outcome: result.outcome,
      attempts: result.attempts,
      httpStatus: 'httpStatus' in result ? result.httpStatus ?? null : null,
      errorMessage: 'errorMessage' in result ? result.errorMessage ?? null : null,
      destination: result.destination,
      deliveredAt: result.outcome === 'delivered' ? new Date() : null,
    });
  },
};

export type ScheduleOpts = DispatchOpts & { store?: OutboundWebhookStore };

export function schedulePartnerWebhook(
  eventType: PartnerWebhookEventType,
  data: Record<string, unknown>,
  opts?: ScheduleOpts
): void {
  const envelope = {
    eventId: opts?.id?.() ?? randomUUID(),
    eventType,
    occurredAt: opts?.now?.().toISOString() ?? new Date().toISOString(),
    data,
  };
  void persistAndDispatch(envelope, opts).catch((err) =>
    logger.error({ err }, 'partner webhook schedule failed')
  );
}

async function persistAndDispatch(
  envelope: {
    eventId: string;
    eventType: PartnerWebhookEventType;
    occurredAt: string;
    data: Record<string, unknown>;
  },
  opts?: ScheduleOpts
): Promise<void> {
  const store = opts?.store ?? defaultStore;
  const { url } = await resolveDestination(opts);
  const rawBody = JSON.stringify(envelope);
  let logId: string | null = null;
  try {
    logId = await store.createPending({
      eventId: envelope.eventId,
      eventType: envelope.eventType,
      payload: envelope.data,
      rawBody,
      destination: url ?? null,
    });
  } catch (err) {
    logger.error({ err, eventId: envelope.eventId }, 'partner webhook outbound log create failed');
  }

  const result = await dispatchPartnerWebhook(envelope, opts);

  if (logId) {
    try {
      await store.finalize(logId, { ...result, destination: url ?? null });
    } catch (err) {
      logger.error({ err, eventId: envelope.eventId }, 'partner webhook outbound log update failed');
    }
  }
}

async function resolveDestination(opts?: DispatchOpts): Promise<{ url?: string | null }> {
  if (opts?.url !== undefined) return { url: opts.url };
  const { env } = await import('@/config/env');
  return { url: env.PARTNER_WEBHOOK_URL };
}
