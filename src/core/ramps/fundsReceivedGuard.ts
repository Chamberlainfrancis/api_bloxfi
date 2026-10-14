/**
 * Once we hold the customer's money, a ramp must never fail or expire on its
 * own: it stays pending (e.g. FIAT_PENDING / CRYPTO_PENDING) until ops retry
 * the payout or decide explicitly. Automatic transitions to a failure status
 * are refused and recorded instead; admin actions pass `allowAfterFunds`.
 * Refunds and cancellations are explicit outcomes and stay allowed.
 */

import type { OnrampStatus } from '@/types/onramp';
import type { OfframpStatus } from '@/types/offramp';

/** Offramp: crypto seen or confirmed onwards. */
const OFFRAMP_FUNDED: ReadonlySet<string> = new Set([
  'CRYPTO_PENDING',
  'CRYPTO_RECEIVED',
  'CRYPTO_CONFIRMED',
  'PROCESSING_FEE',
  'FEE_PROCESSED',
  'FIAT_INITIATED',
  'FIAT_PENDING',
]);

/** Onramp: customer's fiat received onwards. */
const ONRAMP_FUNDED: ReadonlySet<string> = new Set([
  'FIAT_PENDING',
  'FIAT_PROCESSED',
  'CRYPTO_INITIATED',
  'CRYPTO_PENDING',
]);

const OFFRAMP_AUTO_FAIL: ReadonlySet<OfframpStatus> = new Set<OfframpStatus>([
  'EXPIRED',
  'FAILED',
  'FIAT_FAILED',
  'CRYPTO_FAILED',
]);

const ONRAMP_AUTO_FAIL: ReadonlySet<OnrampStatus> = new Set<OnrampStatus>([
  'EXPIRED',
  'FIAT_FAILED',
  'CRYPTO_FAILED',
]);

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** True when the offramp's crypto has arrived, by status or by a credited deposit. */
export function offrampFundsReceived(row: { status: string; timeline?: unknown }): boolean {
  if (OFFRAMP_FUNDED.has(row.status)) return true;
  const t = record(row.timeline);
  const received = Number(t.cryptoReceivedAmount);
  return (
    typeof t.cryptoConfirmedAt === 'string' ||
    typeof t.lastDepositCreditedAt === 'string' ||
    (Number.isFinite(received) && received > 0)
  );
}

export function onrampFundsReceived(row: { status: string }): boolean {
  return ONRAMP_FUNDED.has(row.status);
}

export function blocksOfframpTransition(
  row: { status: string; timeline?: unknown } | null,
  next: OfframpStatus
): boolean {
  return !!row && OFFRAMP_AUTO_FAIL.has(next) && offrampFundsReceived(row);
}

export function blocksOnrampTransition(row: { status: string } | null, next: OnrampStatus): boolean {
  return !!row && ONRAMP_AUTO_FAIL.has(next) && onrampFundsReceived(row);
}

/** What we keep on the row when a failure is refused, so ops can see it. */
export function heldFailureRecord(attemptedStatus: string, reason: string | null | undefined): object {
  return {
    attemptedStatus,
    reason: reason ?? null,
    at: new Date().toISOString(),
  };
}
