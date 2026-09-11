/**
 * Build an offramp fee preview: the provider transfer fee is deducted from the
 * SEND (crypto) side, and the remainder is converted at the rate to produce the
 * net fiat the recipient actually receives. Pure; no I/O.
 *
 * Direction (deduct-from-send) — contrast with onramp's deduct-from-receive:
 *   sendGross  = the crypto the customer sends (fixed)
 *   sendNet    = sendGross − transferFee (in the send currency)
 *   receiveNet = sendNet × rate          (what the recipient is credited)
 *
 * `rate` is derived from the caller-supplied `grossReceive` (= sendGross ×
 * rate) so we never re-guess the rate direction. The fee, already converted
 * into the send currency by the caller (see resolveTransferFeeInSendCurrency),
 * is passed in as `feeInSendCurrency`; null means it could not be previewed or
 * priced → fail soft (no deduction, marked unavailable, recipient still gets
 * the full quoted amount).
 *
 * The fee is surfaced for transparency in its OWN currency (e.g. the provider's
 * USDC funding-asset fee) — never converted into the payout fiat.
 */

import type { RampFeePreview } from '@/types/offramp';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

export function buildOfframpFeePreview(params: {
  /** Crypto the customer sends (e.g. 100 USDT). Fixed — the fee comes out of it. */
  sendAmount: number;
  sendCurrency: string;
  /** Payout fiat currency (e.g. HKD). */
  receiveCurrency: string;
  /** Gross fiat before the provider fee: sendAmount × rate. */
  grossReceive: number;
  /** Decimal places for the fiat receive amounts (typically 2). */
  receiveDecimals: number;
  /** Decimal places for the crypto send amounts (typically 8). */
  sendDecimals: number;
  /**
   * The provider transfer fee already converted into the send currency, or
   * null when unavailable / unpriceable (fail-soft → no deduction).
   */
  feeInSendCurrency: number | null;
  /** Raw fee quote, surfaced verbatim (its own currency) for transparency. */
  feeQuote: PalremitWithdrawalFeeQuote | null;
}): RampFeePreview {
  const { sendAmount, grossReceive } = params;
  const rate = sendAmount > 0 ? grossReceive / sendAmount : 0;

  const usable = params.feeInSendCurrency != null && Number.isFinite(params.feeInSendCurrency);
  const transferFee = usable && params.feeInSendCurrency! > 0 ? params.feeInSendCurrency! : 0;

  // Only the provider transfer fee is deducted. BloxFi's platform fee is NOT
  // applied here — the tenant has already marked up the rate they quote, so the
  // commission is baked into the rate, not a separate deduction.
  const sendNet = Math.max(0, sendAmount - transferFee);
  const receiveNet = sendNet * rate;

  return {
    sendGross: { amount: String(sendAmount), currency: params.sendCurrency },
    sendNet: { amount: sendNet.toFixed(params.sendDecimals), currency: params.sendCurrency },
    receiveGross: { amount: grossReceive.toFixed(params.receiveDecimals), currency: params.receiveCurrency },
    receiveNet: { amount: receiveNet.toFixed(params.receiveDecimals), currency: params.receiveCurrency },
    transferFee: {
      fees: params.feeQuote?.fees ?? [],
      total: params.feeQuote?.totalFee ?? null,
      unavailable: !usable,
    },
  };
}
