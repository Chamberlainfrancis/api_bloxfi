/**
 * Quote-time Palremit P&L check for dest-amount-fixed offramps.
 * insolvent ⇔ receiveNet / effectiveRate > sendNet.
 * Missing/non-positive effectiveRate → skip (fail-soft).
 */

export function offrampImpliedSourceExceedsSendNet(params: {
  sendNet: number;
  receiveNet: number;
  effectiveRate: number | null;
}): boolean {
  const { sendNet, receiveNet, effectiveRate } = params;
  if (effectiveRate == null || !Number.isFinite(effectiveRate) || effectiveRate <= 0) return false;
  if (!Number.isFinite(sendNet) || sendNet <= 0) return false;
  if (!Number.isFinite(receiveNet) || receiveNet < 0) return false;
  return receiveNet / effectiveRate > sendNet;
}
