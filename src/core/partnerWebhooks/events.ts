import type { PartnerWebhookEventType } from '@/types/partnerWebhook';

const ONRAMP_STATUS_TO_EVENT: Record<string, PartnerWebhookEventType> = {
  CREATED: 'onramp.created',
  AWAITING_FUNDS: 'onramp.created',
  FIAT_PENDING: 'onramp.fiat_received',
  FIAT_PROCESSED: 'onramp.fiat_received',
  CRYPTO_INITIATED: 'onramp.crypto_initiated',
  CRYPTO_PENDING: 'onramp.crypto_initiated',
  COMPLETED: 'onramp.completed',
  FIAT_FAILED: 'onramp.failed',
  FIAT_RETURNED: 'onramp.failed',
  CRYPTO_FAILED: 'onramp.failed',
  EXPIRED: 'onramp.expired',
};

const OFFRAMP_STATUS_TO_EVENT: Record<string, PartnerWebhookEventType> = {
  CREATED: 'offramp.created',
  AWAITING_CRYPTO: 'offramp.created',
  CRYPTO_PENDING: 'offramp.crypto_received',
  CRYPTO_RECEIVED: 'offramp.crypto_received',
  CRYPTO_CONFIRMED: 'offramp.crypto_confirmed',
  FIAT_INITIATED: 'offramp.fiat_initiated',
  FIAT_PENDING: 'offramp.fiat_initiated',
  COMPLETED: 'offramp.completed',
  FAILED: 'offramp.failed',
  CRYPTO_FAILED: 'offramp.failed',
  FIAT_FAILED: 'offramp.failed',
  CANCELLED: 'offramp.cancelled',
  REFUNDED: 'offramp.refunded',
  EXPIRED: 'offramp.expired',
};

export function mapOnrampStatusToEvent(status: string): PartnerWebhookEventType | null {
  return ONRAMP_STATUS_TO_EVENT[status.toUpperCase()] ?? null;
}

export function mapOfframpStatusToEvent(status: string): PartnerWebhookEventType | null {
  return OFFRAMP_STATUS_TO_EVENT[status.toUpperCase()] ?? null;
}
