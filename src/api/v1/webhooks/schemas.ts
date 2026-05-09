import { z } from 'zod';

const bloxfiWebhookEventTypeSchema = z.enum([
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
  'onramp.awaiting_funds',
  'onramp.fiat_received',
  'onramp.fiat_processed',
  'onramp.crypto_initiated',
  'onramp.completed',
  'onramp.failed',
  'offramp.created',
  'offramp.crypto_received',
  'offramp.crypto_confirmed',
  'offramp.fee_processed',
  'offramp.fiat_initiated',
  'offramp.completed',
  'offramp.failed',
  'offramp.cancelled',
  'offramp.refunded',
  'limit.reached',
  'high_value_request.approved',
  'high_value_request.rejected',
]);

const bloxfiInboundWebhookPayloadSchema = z
  .object({
    eventId: z.string().min(1).optional(),
    eventld: z.string().min(1).optional(),
    eventType: bloxfiWebhookEventTypeSchema,
    timestamp: z.string().min(1),
    data: z.record(z.unknown()),
  })
  .transform((val) => ({
    eventId: val.eventId ?? val.eventld ?? '',
    eventType: val.eventType,
    timestamp: val.timestamp,
    data: val.data,
  }));

/** Legacy Palremit: { event, data } */
const palremitLegacyWebhookPayloadSchema = z
  .object({
    event: z.string().min(1),
    data: z.record(z.unknown()).optional().default({}),
  })
  .transform((val) => {
    const data = val.data;
    const eventId =
      (typeof data.reference === 'string' && data.reference) ||
      (typeof data.id === 'string' && data.id) ||
      (typeof data.order_id === 'string' && data.order_id) ||
      '';
    return {
      eventId,
      eventType: val.event,
      timestamp: new Date().toISOString(),
      data,
    };
  });

/** Palremit Liquidity Orchestrator envelope */
const palremitOrchestratorWebhookPayloadSchema = z
  .object({
    event_id: z.string().min(1),
    event_type: z.string().min(1),
    occurred_at: z.string().min(1),
    correlation_id: z.string().optional(),
    data: z.record(z.unknown()),
  })
  .transform((val) => ({
    eventId: val.event_id,
    eventType: val.event_type,
    timestamp: val.occurred_at,
    data: val.data,
  }));

export const inboundWebhookPayloadSchema = z.union([
  palremitOrchestratorWebhookPayloadSchema,
  bloxfiInboundWebhookPayloadSchema,
  palremitLegacyWebhookPayloadSchema,
]);

export type InboundWebhookPayloadSchema = z.infer<typeof inboundWebhookPayloadSchema>;
