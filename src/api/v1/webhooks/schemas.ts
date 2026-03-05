import { z } from 'zod';

const webhookEventTypeSchema = z.enum([
  'user.created',
  'user.status_updated',
  'kyb.status_updated',
  'kyb.approved',
  'kyb.rejected',
  'document.reviewed',
  'wallet.created',
  'wallet.updated',
  'wallet.deleted',
  'account.created',
  'account.updated',
  'account.deleted',
  'onramp.created',
  'onramp.completed',
  'onramp.failed',
  'offramp.created',
  'offramp.crypto_received',
  'offramp.completed',
  'offramp.failed',
  'limit.reached',
  'high_value_request.approved',
  'high_value_request.rejected',
]);

export const inboundWebhookPayloadSchema = z.object({
  eventId: z.string().min(1),
  eventType: webhookEventTypeSchema,
  timestamp: z.string().min(1),
  data: z.record(z.unknown()),
});

export type InboundWebhookPayloadSchema = z.infer<typeof inboundWebhookPayloadSchema>;
