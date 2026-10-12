/**
 * Palremit payout-fee policy bloxfi can apply without a live Palremit preview.
 *
 * Only WIRE has a hardcoded fee we will use when the preview is missing:
 * $0, matching liquidity-orchestrator `FIAT_WITHDRAWAL_FEE` (Palremit waived
 * every fiat payout fee 2026-10-12; was $25 SWIFT).
 * GBP is excluded — Palremit remaps GBP|GB|WIRE to local BANK_TRANSFER at $0,
 * so a missing preview must fail closed rather than guess.
 * Every other rail stays unknown: no quote.
 */

export const WIRE_FLAT_FEE_USDC = 0;

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
