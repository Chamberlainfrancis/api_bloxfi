/**
 * Offramp crypto deposit amount checks for `deposit.credited` webhooks.
 * Payout runs only when cumulative credited amount meets the quoted deposit.
 */

/** Compare quoted vs received crypto at cents. Palremit/Quidax often credit 2dp. */
export const OFFRAMP_CRYPTO_DECIMALS = 2;

/**
 * Max underpayment still treated as a complete deposit, in source-asset units
 * after 2dp rounding. Extend this map for other assets later.
 */
export const OFFRAMP_UNDERPAYMENT_TOLERANCE_BY_ASSET: Readonly<Record<string, number>> = {
  USDT: 1,
  USDC: 1,
  USD: 1,
};

export function roundOfframpCryptoAmount(amount: number): number {
  const scale = 10 ** OFFRAMP_CRYPTO_DECIMALS;
  return Math.round(amount * scale) / scale;
}

export function underpaymentToleranceForAsset(asset: string | null | undefined): number {
  if (typeof asset !== 'string' || asset.trim() === '') return 0;
  return OFFRAMP_UNDERPAYMENT_TOLERANCE_BY_ASSET[asset.trim().toUpperCase()] ?? 0;
}

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

/** True when cumulative credited crypto meets the quoted deposit (2dp), or a configured underpayment. */
export function isOfframpCryptoDepositComplete(
  cumulativeReceived: number,
  expectedAmount: number,
  sourceCurrency?: string | null
): boolean {
  if (!Number.isFinite(cumulativeReceived) || !Number.isFinite(expectedAmount) || expectedAmount <= 0) {
    return false;
  }
  const received = roundOfframpCryptoAmount(cumulativeReceived);
  const expected = roundOfframpCryptoAmount(expectedAmount);
  if (received >= expected) return true;
  const shortfall = expected - received;
  const tolerance = underpaymentToleranceForAsset(sourceCurrency);
  return tolerance > 0 && shortfall < tolerance;
}
