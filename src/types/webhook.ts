/**
 * Inbound webhook payload types from LPs (docs/bloxfi-liquidity-provider-integration-spec).
 * Headers: X-Webhook-Signature, X-Webhook-Id, X-Webhook-Timestamp.
 */

export type WebhookEventType =
  | 'user.created'
  | 'user.status_updated'
  | 'kyb.status_updated'
  | 'kyb.approved'
  | 'kyb.rejected'
  | 'document.reviewed'
  | 'wallet.created'
  | 'wallet.updated'
  | 'wallet.deleted'
  | 'account.created'
  | 'account.updated'
  | 'account.deleted'
  | 'onramp.created'
  | 'onramp.completed'
  | 'onramp.failed'
  | 'offramp.created'
  | 'offramp.crypto_received'
  | 'offramp.completed'
  | 'offramp.failed'
  | 'limit.reached'
  | 'high_value_request.approved'
  | 'high_value_request.rejected';

export interface InboundWebhookPayload {
  eventId: string;
  eventType: WebhookEventType;
  timestamp: string; // ISO 8601
  data: Record<string, unknown>;
}

/** KYB status webhook data */
export interface WebhookKybData {
  userId: string;
  kybStatus?: string;
  rails?: string[];
  previousStatus?: string;
}

/** Onramp status webhook data */
export interface WebhookOnrampData {
  onrampId: string;
  userId: string;
  status?: string;
  transactionHash?: string;
  [key: string]: unknown;
}

/** Offramp status webhook data */
export interface WebhookOfframpData {
  offrampId: string;
  userId: string;
  transactionHash?: string;
  failureReason?: string;
  refundStatus?: string;
  [key: string]: unknown;
}
