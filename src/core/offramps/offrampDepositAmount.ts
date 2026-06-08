/**
 * Offramp crypto deposit amount checks for `deposit.credited` webhooks.
 * Payout runs only when cumulative credited amount meets the quoted deposit.
 */

/** Tolerance for crypto amount comparison (USDT-scale; 6 decimal places). */
export const OFFRAMP_CRYPTO_AMOUNT_EPSILON = 1e-6;

export function parseDepositWebhookAmount(deposit: Record<string, unknown>): number | null {
  const raw = deposit.amount;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

export function expectedOfframpCryptoAmount(offramp: {
  source: unknown;
  depositInstructions: unknown;
}): number | null {
  const src =
    offramp.source != null && typeof offramp.source === 'object' && !Array.isArray(offramp.source)
      ? (offramp.source as Record<string, unknown>)
      : null;
  if (src != null) {
    const fromSource = src.amount;
    if (typeof fromSource === 'number' && Number.isFinite(fromSource) && fromSource > 0) {
      return fromSource;
    }
    if (typeof fromSource === 'string' && fromSource.trim() !== '') {
      const n = Number(fromSource.trim());
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  const di =
    offramp.depositInstructions != null &&
    typeof offramp.depositInstructions === 'object' &&
    !Array.isArray(offramp.depositInstructions)
      ? (offramp.depositInstructions as Record<string, unknown>)
      : null;
  if (di != null && typeof di.amount === 'string' && di.amount.trim() !== '') {
    const n = Number(di.amount.trim());
    if (Number.isFinite(n) && n > 0) return n;
  }

  return null;
}

export function priorCryptoReceivedAmount(timeline: unknown): number {
  if (timeline == null || typeof timeline !== 'object' || Array.isArray(timeline)) return 0;
  const raw = (timeline as Record<string, unknown>).cryptoReceivedAmount;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw.trim());
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return 0;
}

/** True when cumulative credited crypto meets or exceeds the quoted deposit amount. */
export function isOfframpCryptoDepositComplete(
  cumulativeReceived: number,
  expectedAmount: number,
  epsilon = OFFRAMP_CRYPTO_AMOUNT_EPSILON
): boolean {
  if (!Number.isFinite(cumulativeReceived) || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return false;
  }
  return cumulativeReceived + epsilon >= expectedAmount;
}
