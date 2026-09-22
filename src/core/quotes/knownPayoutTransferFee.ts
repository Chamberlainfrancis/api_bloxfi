/**
 * Palremit payout-fee policy bloxfi can apply without a live Palremit preview.
 *
 * Only WIRE has a hardcoded fee we will use when the preview is missing:
 * $25 SWIFT (USDC), matching liquidity-orchestrator `WIRE_FLAT_FEE`.
 * GBP is excluded — Palremit remaps GBP|GB|WIRE to local BANK_TRANSFER at $0,
 * so a missing preview must fail closed rather than guess $25 or $0.
 * Every other rail stays unknown: no quote.
 */

export const WIRE_FLAT_FEE_USDC = 25;

export function knownPayoutTransferFeeUsdc(input: {
  destinationType: string;
  toCurrency: string;
}): number | null {
  const rail = input.destinationType.trim().toLowerCase();
  const fiat = input.toCurrency.trim().toLowerCase();
  if (rail !== 'wire') return null;
  if (fiat === 'gbp') return null;
  return WIRE_FLAT_FEE_USDC;
}
