/**
 * USDT/USDC → USD offramp pricing (agreed with the client, 2026-10-05):
 *
 *   customer rate = currency-api marketRate × (1 − 20 bps)   (pairMarkup.config)
 *   wire          = flat $25 SWIFT fee, charged separately
 *   local bank    = no transfer fee
 *
 * The payout provider's own cost (OwlPay's funding spread, Harbor's fee and
 * the wire charge inside its rate) is Palremit's cost, never the client's.
 * So the rate is NOT floored at the provider's executable rate and the
 * provider's spread is NOT passed on as a transfer fee.
 *
 * The funding cap sent to Palremit covers the provider's cost at quote time
 * plus headroom; Palremit pauses the payout for ops if the cost moves beyond it.
 */

import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';
import { WIRE_FLAT_FEE_USDC } from '@/core/quotes/knownPayoutTransferFee';

/**
 * Headroom over the provider's quoted source amount. Covers Harbor's fee
 * (~12 bps, billed on top of source) plus rate drift between quote and payout.
 */
export const USD_SELL_FUNDING_HEADROOM = 0.0025;

export function isUsdStableSell(fromCurrency: string, toCurrency: string): boolean {
  const from = fromCurrency.trim().toUpperCase();
  return toCurrency.trim().toUpperCase() === 'USD' && (from === 'USDT' || from === 'USDC');
}

/**
 * The transfer fee the client pays, as its own fee line. Wire: Palremit's
 * published wire fee ($25 if the preview is missing). Local bank: none —
 * Palremit's USD local "fee" is the provider's funding spread, which is ours.
 */
export function usdSellCustomerFeeQuote(
  destinationType: string,
  provider: PalremitWithdrawalFeeQuote | null,
): PalremitWithdrawalFeeQuote {
  const wire = destinationType.trim().toLowerCase() === 'wire';
  const previewed = Number(provider?.totalFee?.amount);
  const previewedOk =
    provider != null &&
    !provider.feeUnavailable &&
    Number.isFinite(previewed) &&
    previewed >= 0;
  const amount = wire ? String(previewedOk ? previewed : WIRE_FLAT_FEE_USDC) : '0';
  const currency = wire && previewedOk ? provider!.totalFee!.currency : 'USDC';
  return {
    feeUnavailable: false,
    fees: wire ? [{ kind: 'SWIFT fee', amount, currency }] : [],
    totalFee: { amount, currency },
    destinationAmount: provider?.destinationAmount ?? null,
    effectiveRate: provider?.effectiveRate ?? null,
    expiresAt: provider?.expiresAt ?? null,
  };
}

/**
 * Max stablecoin Palremit may spend funding the payout: the provider's source
 * for `receiveNet` at its executable rate, plus headroom. Never below sendNet.
 */
export function usdSellSourceAmountCap(params: {
  sendNet: number;
  receiveNet: number;
  executableRate: number;
}): number {
  const providerSource = params.receiveNet / params.executableRate;
  return Math.max(params.sendNet, providerSource * (1 + USD_SELL_FUNDING_HEADROOM));
}
