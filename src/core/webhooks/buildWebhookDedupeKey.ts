/**
 * Stable idempotency key for Palremit webhook deliveries (retries must dedupe).
 */

import { createHash } from 'node:crypto';
import { stableStringify } from '@/utils/stableJson';

function palremitClientReferenceFromData(data: Record<string, unknown>): string {
  const top = typeof data.client_reference === 'string' ? data.client_reference.trim() : '';
  if (top) return top;
  const w = data.withdrawal;
  if (w != null && typeof w === 'object' && !Array.isArray(w)) {
    const cr = (w as Record<string, unknown>).client_reference;
    if (typeof cr === 'string' && cr.trim()) return cr.trim();
  }
  const legacy = typeof data.txnRef === 'string' ? data.txnRef.trim() : '';
  return legacy;
}

export function buildPalremitWebhookDedupeKey(eventType: string, data: Record<string, unknown>): string {
  const txnRef = palremitClientReferenceFromData(data);
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
