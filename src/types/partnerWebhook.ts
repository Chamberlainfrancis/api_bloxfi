export type PartnerWebhookEventType =
  | 'user.created'
  | 'kyb.status_updated'
  | 'account.created'
  | 'account.updated'
  | 'account.deleted'
  | 'account.capabilities.updated'
  | 'onramp.created'
  | 'onramp.fiat_received'
  | 'onramp.crypto_initiated'
  | 'onramp.completed'
  | 'onramp.failed'
  | 'onramp.expired'
  | 'offramp.created'
  | 'offramp.crypto_received'
  | 'offramp.crypto_confirmed'
  | 'offramp.fiat_initiated'
  | 'offramp.completed'
  | 'offramp.failed'
  | 'offramp.cancelled'
  | 'offramp.refunded'
  | 'offramp.expired';

export interface PartnerWebhookEnvelope {
  eventId: string;
  eventType: PartnerWebhookEventType;
  occurredAt: string;
  data: Record<string, unknown>;
}
