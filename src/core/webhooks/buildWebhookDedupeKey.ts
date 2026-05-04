/**
 * Stable idempotency key for Palremit webhook deliveries (retries must dedupe).
 */

import { createHash } from 'node:crypto';
import { stableStringify } from '@/utils/stableJson';

export function buildPalremitWebhookDedupeKey(eventType: string, data: Record<string, unknown>): string {
  const txnRef = typeof data.txnRef === 'string' ? data.txnRef.trim() : '';
  const provId =
    typeof data.id === 'string'
      ? data.id.trim()
      : typeof data._id === 'string'
        ? data._id.trim()
        : '';
  const bodyHash = createHash('sha256').update(stableStringify(data)).digest('hex').slice(0, 32);
  if (txnRef && provId) {
    return `palremit:${eventType}:${txnRef}:${provId}`;
  }
  if (txnRef) {
    return `palremit:${eventType}:${txnRef}:${bodyHash}`;
  }
  return `palremit:${eventType}:notxn:${bodyHash}`;
}
