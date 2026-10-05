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
