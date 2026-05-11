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
  const acc = data.account;
  if (acc != null && typeof acc === 'object' && !Array.isArray(acc)) {
    const cr = (acc as Record<string, unknown>).client_reference;
    if (typeof cr === 'string' && cr.trim()) return cr.trim();
  }
  const legacy = typeof data.txnRef === 'string' ? data.txnRef.trim() : '';
  return legacy;
}

function palremitStableEntityIdFromData(data: Record<string, unknown>): string {
  const top =
    typeof data.id === 'string'
      ? data.id.trim()
      : typeof data._id === 'string'
        ? data._id.trim()
        : '';
  if (top) return top;
  const dep = data.deposit;
  if (dep != null && typeof dep === 'object' && !Array.isArray(dep)) {
    const id = (dep as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  const wd = data.withdrawal;
  if (wd != null && typeof wd === 'object' && !Array.isArray(wd)) {
    const id = (wd as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  const acc = data.account;
  if (acc != null && typeof acc === 'object' && !Array.isArray(acc)) {
    const id = (acc as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) return id.trim();
  }
  return '';
}

export function buildPalremitWebhookDedupeKey(eventType: string, data: Record<string, unknown>): string {
  const txnRef = palremitClientReferenceFromData(data);
  const provId = palremitStableEntityIdFromData(data);
  const bodyHash = createHash('sha256').update(stableStringify(data)).digest('hex').slice(0, 32);
  if (txnRef && provId) {
    return `palremit:${eventType}:${txnRef}:${provId}`;
  }
  if (txnRef) {
    return `palremit:${eventType}:${txnRef}:${bodyHash}`;
  }
  return `palremit:${eventType}:notxn:${bodyHash}`;
}
