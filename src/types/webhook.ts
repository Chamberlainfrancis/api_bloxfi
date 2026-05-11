/**
 * Inbound webhook payloads: BloxFi-shaped (spec), Palremit legacy `{ event, data }`,
 * or Palremit Liquidity Orchestrator `{ event_id, event_type, occurred_at, data }`.
 * Palremit verification: `X-Webhook-Signature` (HMAC-SHA256). Dedupe on `X-Liquidity-Event-Id` when present.
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
  | 'onramp.awaiting_funds'
  | 'onramp.fiat_received'
  | 'onramp.fiat_processed'
  | 'onramp.crypto_initiated'
  | 'onramp.completed'
  | 'onramp.failed'
  | 'offramp.created'
  | 'offramp.crypto_received'
  | 'offramp.crypto_confirmed'
  | 'offramp.fee_processed'
  | 'offramp.fiat_initiated'
  | 'offramp.completed'
  | 'offramp.failed'
  | 'offramp.cancelled'
  | 'offramp.refunded'
  | 'limit.reached'
  | 'high_value_request.approved'
  | 'high_value_request.rejected';

/** Palremit Liquidity Orchestrator outbound webhook `event_type` values (see LP docs). */
export type PalremitLiquidityWebhookEventType =
  | "deposit.credited"
  | "withdrawal.successful"
  | "withdrawal.failed"
  | "provisioned_account.active"
  | "provisioned_account.failed"
  | "provisioned_account.kyc_pending";

export interface InboundWebhookPayload {
  eventId: string;
  /** BloxFi LP event names or other provider strings. */
  eventType: string;
  timestamp: string; // ISO 8601
  data: Record<string, unknown>;
  /** Present when payload is Palremit Liquidity Orchestrator envelope. */
  correlationId?: string;
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
