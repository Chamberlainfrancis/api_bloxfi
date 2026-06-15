/**
 * Build a fee preview for a rate quote: gross receive, Palremit payout fee, and
 * net receive (deduct-from-receive). Pure; no I/O. Used by the rates endpoints.
 */

import type { RampFeePreview } from '@/types/offramp';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

export function buildRampFeePreview(params: {
  /** Input amount the user sends (crypto for offramp; fiat for onramp). */
  sendAmount: number;
  sendCurrency: string;
  /** Receive currency (fiat for offramp; crypto for onramp). */
  receiveCurrency: string;
  /**
   * Gross receive before the provider fee, computed by the caller in the
   * correct direction (offramp: crypto × rate; onramp: the amount-specific
   * fiat→crypto conversion). Passed in to avoid rate-direction guessing.
   */
  grossReceive: number;
  /** Decimal places to format receive amounts (fiat=2, crypto=8). */
  receiveDecimals: number;
  feeQuote: PalremitWithdrawalFeeQuote | null;
}): RampFeePreview {
  const grossReceive = params.grossReceive;
  const fq = params.feeQuote;
  const usable =
    fq != null &&
    !fq.feeUnavailable &&
    fq.totalFee != null &&
    fq.totalFee.currency.toUpperCase() === params.receiveCurrency.toUpperCase();
  const parsed = usable && fq ? Number(fq.totalFee!.amount) : 0;
  const fee = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  const netReceive = Math.max(0, grossReceive - fee);
  return {
    sendGross: { amount: String(params.sendAmount), currency: params.sendCurrency },
    receiveGross: { amount: grossReceive.toFixed(params.receiveDecimals), currency: params.receiveCurrency },
    receiveNet: { amount: netReceive.toFixed(params.receiveDecimals), currency: params.receiveCurrency },
    providerFee: {
      fees: fq?.fees ?? [],
      total: fq?.totalFee ?? null,
      unavailable: !usable,
    },
  };
}
