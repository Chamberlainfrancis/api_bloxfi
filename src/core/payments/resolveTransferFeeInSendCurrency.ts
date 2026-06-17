/**
 * Convert a Palremit payout (transfer) fee into the offramp SEND currency.
 *
 * Why this exists: for an offramp the downstream provider (e.g. OwlPay) is
 * destination-amount-fixed — it always delivers exactly the requested fiat
 * payout and charges its fee on the FUNDING leg, denominated in the funding
 * asset (e.g. USDC), NOT in the payout fiat. The correct way to make the
 * customer whole is therefore to deduct the fee from the crypto they SEND
 * (so the converted receive amount already reflects the fee), not to subtract
 * it from the fiat they receive. Subtracting a funding-asset fee from the fiat
 * leg is a currency mismatch and was the root cause of the receive-amount
 * shortfall bug (the fee was wrongly converted into fiat and deducted twice in
 * effect).
 *
 * The fee can be denominated in any currency (the funding asset, or — for
 * other corridors — the payout fiat). This converts it into the send currency
 * via the same Palremit conversion API used for the offramp rate. Same-currency
 * fees skip the lookup. Returns null when the fee is unknown or cannot be
 * priced — callers MUST fail soft (no deduction) rather than guess, so the
 * customer is never quoted less than the provider will actually deliver.
 */

import type { GetOfframpRatesResponse } from '@/types/offramp';
import type { PalremitWithdrawalFeeQuote } from '@/core/integrations/palremitWithdrawalQuote';

export type GetRateFn = (
  from: string,
  to: string,
  fromChain?: string
) => Promise<GetOfframpRatesResponse | null>;

/**
 * Resolve the provider transfer fee in the send currency.
 *
 * @returns the fee amount expressed in `sendCurrency`, or null when it is
 *   unavailable / cannot be converted (fail-soft: caller must not deduct).
 */
export async function resolveTransferFeeInSendCurrency(params: {
  feeQuote: PalremitWithdrawalFeeQuote | null;
  sendCurrency: string;
  getRate: GetRateFn;
}): Promise<number | null> {
  const { feeQuote, sendCurrency, getRate } = params;
  if (!feeQuote || feeQuote.feeUnavailable || !feeQuote.totalFee) return null;

  const feeAmount = Number(feeQuote.totalFee.amount);
  if (!Number.isFinite(feeAmount) || feeAmount < 0) return null;
  // A genuine zero fee is a known fee (not "unavailable") — deduct nothing.
  if (feeAmount === 0) return 0;

  const feeCurrency = feeQuote.totalFee.currency.trim().toUpperCase();
  const sendCcy = sendCurrency.trim().toUpperCase();
  if (feeCurrency === sendCcy) return feeAmount;

  const rateRes = await getRate(feeCurrency.toLowerCase(), sendCcy.toLowerCase());
  if (!rateRes) return null;
  // conversionRate is "send units per 1 fee unit".
  const rate = parseFloat(rateRes.conversionRate);
  if (!Number.isFinite(rate) || rate <= 0) return null;

  return feeAmount * rate;
}
