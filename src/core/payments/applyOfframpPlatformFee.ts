/**
 * Offramp platform fee calculation. Pure functions; no I/O.
 * Platform fee: PERCENTAGE or FLAT per spec §5.
 */

import type { PlatformFee } from '../../types/offramp';

export interface OfframpPlatformFeeResult {
  /** Fee amount in same unit as input (crypto or fiat as applicable). */
  feeAmount: number;
  /** Amount after deducting fee (e.g. receiveNet = receiveGross - feeAmount). */
  netAmount: number;
  /** Gross amount (input). */
  grossAmount: number;
}

/**
 * Apply offramp platform fee to a gross amount.
 * PERCENTAGE: feeAmount = grossAmount * value (value as decimal e.g. 0.01 = 1%); netAmount = grossAmount - feeAmount.
 * FLAT: feeAmount = value; netAmount = grossAmount - value.
 */
export function applyOfframpPlatformFee(
  grossAmount: number,
  fee: PlatformFee
): OfframpPlatformFeeResult {
  if (grossAmount < 0) {
    throw new Error('applyOfframpPlatformFee: grossAmount must be non-negative');
  }
  let feeAmount: number;
  if (fee.type === 'FLAT') {
    feeAmount = Math.max(0, Number(fee.value));
  } else {
    // PERCENTAGE: value as decimal e.g. 0.01 = 1%
    const rate = Math.max(0, Math.min(1, Number(fee.value)));
    feeAmount = grossAmount * rate;
  }
  const netAmount = Math.max(0, grossAmount - feeAmount);
  return { feeAmount, netAmount, grossAmount };
}
