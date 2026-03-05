/**
 * Webhook signature verification for inbound LP webhooks.
 * HMAC SHA256(webhook_id + "." + timestamp + "." + rawBody, secret).
 * No business logic; verification only. Spec: Webhook Format, Signature Verification.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const SIG_PREFIX = 'sha256=';

/**
 * Verify LP webhook signature. Uses raw body as received.
 * Header format: X-Webhook-Signature: sha256={hex}
 * Returns true only if signature matches and secret is non-empty.
 */
export function verifyWebhookSignature(
  webhookId: string,
  timestamp: string,
  rawBody: string | Buffer,
  secret: string,
  headerSignature: string
): boolean {
  if (!secret || !headerSignature || typeof webhookId !== 'string' || typeof timestamp !== 'string') {
    return false;
  }
  const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const payload = `${webhookId}.${timestamp}.${bodyStr}`;
  const expected = createHmac('sha256', secret).update(payload).digest('hex');
  const received = headerSignature.startsWith(SIG_PREFIX)
    ? headerSignature.slice(SIG_PREFIX.length)
    : headerSignature;
  if (received.length !== 64 || expected.length !== 64) return false;
  try {
    return timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Check if webhook timestamp is within allowed window (replay protection).
 * timestamp is Unix seconds. maxAgeSeconds typically 300 (5 min) or 600 (10 min).
 */
export function isWebhookTimestampFresh(timestampStr: string, maxAgeSeconds: number): boolean {
  const ts = parseInt(timestampStr, 10);
  if (Number.isNaN(ts) || ts <= 0) return false;
  const now = Math.floor(Date.now() / 1000);
  return ts >= now - maxAgeSeconds && ts <= now + 60; // allow 1 min clock skew future
}
