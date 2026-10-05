/**
 * Cap the FX mid we sell at the live executable provider rate.
 * Currency-api can be stale (EUR B2B sat at 0.870293 for 41 days) while OwlPay
 * pays out at a worse rate. Never quote more fiat per crypto than the provider
 * will actually fund.
 */
export function floorOfframpMarketRate(
  currencyApiMarket: number,
  executableRate: number | null,
): number {
  if (
    executableRate == null ||
    !Number.isFinite(executableRate) ||
    executableRate <= 0
  ) {
    return currencyApiMarket;
  }
  return Math.min(currencyApiMarket, executableRate);
}

/** True when a parsed OwlPay (or other dest-fixed) effective_rate can be used as a floor. */
export function isUsableExecutableRate(rate: number | null | undefined): rate is number {
  return rate != null && Number.isFinite(rate) && rate > 0;
}

/**
 * For USD payouts the provider's effective_rate (destination / source) carries
 * its payout cost: the whole funding spread on local bank (which is also what
 * we charge as the transfer fee), and the ~$25 wire charge plus Harbor's fee on
 * WIRE (where we charge a flat $25). Flooring on the raw rate AND deducting the
 * fee charges that cost twice. Strip the fee from the rate — never more than
 * the spread actually inside it — and report the stripped amount so callers
 * can count it once.
 *
 * Only USD payouts from a stablecoin send: other fiats mix units, and the
 * fee must convert 1:1 into the send currency.
 */
export function executableRateExcludingTransferFee(params: {
  fromCurrency: string;
  toCurrency: string;
  executableRate: number | null;
  feeQuote: {
    feeUnavailable: boolean;
    totalFee: { amount: string; currency: string } | null;
    destinationAmount: string | null;
  } | null;
}): { executableRate: number | null; embeddedFee: number } {
  const unchanged = { executableRate: params.executableRate, embeddedFee: 0 };
  const exec = params.executableRate;
  if (!isUsableExecutableRate(exec)) return unchanged;
  if (params.toCurrency.trim().toLowerCase() !== 'usd') return unchanged;
  const from = params.fromCurrency.trim().toUpperCase();
  if (from !== 'USDT' && from !== 'USDC') return unchanged;

  const q = params.feeQuote;
  if (!q || q.feeUnavailable || !q.totalFee) return unchanged;
  const feeCcy = q.totalFee.currency.trim().toUpperCase();
  if (feeCcy !== 'USDT' && feeCcy !== 'USDC') return unchanged;
  const fee = Number(q.totalFee.amount);
  const dest = Number(q.destinationAmount);
  if (!Number.isFinite(fee) || fee <= 0) return unchanged;
  if (!Number.isFinite(dest) || dest <= 0) return unchanged;

  const impliedSource = dest / exec;
  const spread = impliedSource - dest;
  if (!(spread > 0.01)) return unchanged;
  const embedded = Math.min(fee, spread);
  const sourceExFee = impliedSource - embedded;
  if (!(sourceExFee > 0)) return unchanged;

  return { executableRate: dest / sourceExFee, embeddedFee: embedded };
}
