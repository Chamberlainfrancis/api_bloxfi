import { randomUUID } from 'crypto';
import { logger } from '@/lib/logger';
import type { PartnerWebhookEventType } from '@/types/partnerWebhook';
import { dispatchPartnerWebhook, type DispatchOpts } from '@/core/partnerWebhooks/dispatch';

export function schedulePartnerWebhook(
  eventType: PartnerWebhookEventType,
  data: Record<string, unknown>,
  opts?: DispatchOpts
): void {
  const envelope = {
    eventId: opts?.id?.() ?? randomUUID(),
    eventType,
    occurredAt: opts?.now?.().toISOString() ?? new Date().toISOString(),
    data,
  };
  void dispatchPartnerWebhook(envelope, opts).catch((err) =>
    logger.error({ err }, 'partner webhook schedule failed')
  );
}
