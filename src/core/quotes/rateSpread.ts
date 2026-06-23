/**
 * Palremit rate-spread profit: the gap between the Currency API mid `marketRate`
 * and our quoted b2b `rate`, expressed in the conversion's output currency and
 * normalized to USDC. Independent of platformFee. Pure except for the injected
 * USDC conversion in buildPalremitProfit.
 */

export interface PalremitProfit {
  amountUsdc: string | null;   // normalized; null if USDC conversion unavailable
  currency: string;            // native profit currency = toCurrency
  amountInCurrency: string;    // profit in `currency`, 8dp
  customerRate: string;        // our quoted b2b rate
  marketRate: string;          // Currency API mid rate
  computedAt: string;          // ISO timestamp
}

/**
 * Profit in the output (to) currency. Orientation: the API quotes `rate` as
 * `rateCurrency per perCurrency`, so the output amount is amount×rate when the
 * output IS the rateCurrency, and amount÷rate when it is the perCurrency.
 */
export function computeRateSpreadProfit(p: {
  sourceAmount: number;
  toCurrency: string;
  rate: number;
  marketRate: number;
  rateCurrency: string;
  perCurrency: string;
}): { amount: number; currency: string } | null {
  const { sourceAmount, toCurrency, rate, marketRate, rateCurrency, perCurrency } = p;
  if (
    !Number.isFinite(sourceAmount) || sourceAmount <= 0 ||
    !Number.isFinite(rate) || rate <= 0 ||
    !Number.isFinite(marketRate) || marketRate <= 0
  ) return null;

  const to = toCurrency.trim().toUpperCase();
  const rc = rateCurrency.trim().toUpperCase();
  const pc = perCurrency.trim().toUpperCase();

  let outCustomer: number;
  let outMarket: number;
  if (to === rc) {
    outCustomer = sourceAmount * rate;
    outMarket = sourceAmount * marketRate;
  } else if (to === pc) {
    outCustomer = sourceAmount / rate;
    outMarket = sourceAmount / marketRate;
  } else {
    return null;
  }

  const amount = outMarket - outCustomer;
  if (!Number.isFinite(amount) || amount <= 0) return { amount: 0, currency: toCurrency };
  return { amount, currency: toCurrency };
}

export async function buildPalremitProfit(p: {
  sourceAmount: number;
  toCurrency: string;
  rate: string | number | undefined;
  marketRate: string | number | undefined;
  rateCurrency: string | undefined;
  perCurrency: string | undefined;
  nowIso: string;
  convertToUsdc: (from: string, amount: number) => Promise<number | null>;
}): Promise<PalremitProfit | null> {
  const rate = typeof p.rate === 'string' ? parseFloat(p.rate) : p.rate;
  const marketRate = typeof p.marketRate === 'string' ? parseFloat(p.marketRate) : p.marketRate;
  if (rate == null || marketRate == null || !p.rateCurrency || !p.perCurrency) return null;

  const spread = computeRateSpreadProfit({
    sourceAmount: p.sourceAmount,
    toCurrency: p.toCurrency,
    rate,
    marketRate,
    rateCurrency: p.rateCurrency,
    perCurrency: p.perCurrency,
  });
  if (!spread) return null;

  let amountUsdc: string | null;
  if (spread.amount <= 0) {
    amountUsdc = '0.00000000';
  } else {
    const from = p.toCurrency.trim().toUpperCase();
    if (from === 'USDC') {
      amountUsdc = spread.amount.toFixed(8);
    } else {
      const usdc = await p.convertToUsdc(from, spread.amount);
      amountUsdc = usdc != null && Number.isFinite(usdc) ? usdc.toFixed(8) : null;
    }
  }

  return {
    amountUsdc,
    currency: p.toCurrency,
    amountInCurrency: spread.amount.toFixed(8),
    customerRate: String(rate),
    marketRate: String(marketRate),
    computedAt: p.nowIso,
  };
}
