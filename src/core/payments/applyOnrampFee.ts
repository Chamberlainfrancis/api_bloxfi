/**
 * Onramp fee calculation. Pure functions; no I/O.
 * Fee object is complete per spec-clarifications §3: type (FIX | PERCENT) and value only.
 */

import type { OnrampFee } from '../../types/onramp';

export interface OnrampFeeResult {
  /** Fee amount in same unit as input (fiat or crypto as applicable). */
  feeAmount: number;
  /** Amount after deducting fee (e.g. receiveNet = receiveGross - feeAmount). */
  netAmount: number;
  /** Gross amount (input). */
  grossAmount: number;
}

/**
 * Apply onramp fee to a gross amount. Returns fee amount and net amount.
 * FIX: feeAmount = value; netAmount = grossAmount - value.
 * PERCENT: feeAmount = grossAmount * value; netAmount = grossAmount - feeAmount.
 */
export function applyOnrampFee(grossAmount: number, fee: OnrampFee): OnrampFeeResult {
  if (grossAmount < 0) {
    throw new Error('applyOnrampFee: grossAmount must be non-negative');
  }
  let feeAmount: number;
  if (fee.type === 'FIX') {
    feeAmount = Math.max(0, Number(fee.value));
  } else {
    // PERCENT: value as decimal e.g. 0.01 = 1%
    const rate = Math.max(0, Math.min(1, Number(fee.value)));
    feeAmount = grossAmount * rate;
  }
  const netAmount = Math.max(0, grossAmount - feeAmount);
  return { feeAmount, netAmount, grossAmount };
}
