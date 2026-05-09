/**
 * Inbound webhook signature verification.
 * Palremit (legacy + Liquidity Orchestrator): `X-Webhook-Signature` = HMAC-SHA256 hex of raw/canonical body; secret = `WEBHOOK_SECRET`.
 * Accepts either canonical JSON.stringify(body) or raw UTF-8 body if Palremit signs the raw bytes.
 */

import { createHmac, timingSafeEqual } from 'crypto';

const SIG_PREFIX = 'sha256=';

function hexTimingSafeEqual(a: string, b: string): boolean {
  if (a.length !== 64 || b.length !== 64) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/**
 * Verify Palremit webhook signature.
 * Header: X-Webhook-Signature (hex or sha256=hex).
 */
export function verifyPalremitWebhookSignature(
  rawBodyUtf8: string,
  secret: string,
  headerSignature: string
): boolean {
  if (!secret || !headerSignature || !rawBodyUtf8) {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBodyUtf8);
  } catch {
    return false;
  }
  const canonical = JSON.stringify(parsed);
  const hmacHex = (payload: string) =>
    createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  const expectedCanonical = hmacHex(canonical);
  const expectedRaw = hmacHex(rawBodyUtf8);
  const received = headerSignature.startsWith(SIG_PREFIX)
    ? headerSignature.slice(SIG_PREFIX.length).trim()
    : headerSignature.trim();
  if (received.length !== 64) return false;
  return (
    hexTimingSafeEqual(received, expectedCanonical) || hexTimingSafeEqual(received, expectedRaw)
  );
}
