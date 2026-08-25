/**
 * Core: get offramp rate (crypto → fiat). Palremit Currency API only (palremit_rates_guide.md).
 */

import type { GetOfframpRatesResponse } from '@/types/offramp';
import { applyPairMarkupIfMatched } from '@/core/quotes/pairMarkup';

export interface GetOfframpRateOptions {
  getRateFromPalremit?: (
    from: string,
    to: string,
    fromChain?: string
  ) => Promise<GetOfframpRatesResponse | null>;
}

/**
 * Get conversion rate for fromCurrency (crypto) → toCurrency (fiat). Palremit only; throws if unavailable.
 */
export async function getOfframpRate(
  fromCurrency: string,
  toCurrency: string,
  fromChain: string | undefined,
  options: GetOfframpRateOptions | null
): Promise<GetOfframpRatesResponse> {
  const opts = (options && typeof options === 'object' ? options : null) ?? {};
  const from = (fromCurrency ?? '').trim().toLowerCase();
  const to = (toCurrency ?? '').trim().toLowerCase();
  const chain = fromChain?.trim() ? fromChain.trim() : undefined;

  if (!from || !to) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }

  if (!opts.getRateFromPalremit) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }

  const result = await opts.getRateFromPalremit(from, to, chain);
  if (!result) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const priced = applyPairMarkupIfMatched({
    fromCurrency: from,
    toCurrency: to,
    amount: 1,
    marketRate: result.marketRate,
    rateCurrency: result.rateCurrency,
    perCurrency: result.perCurrency,
  });
  if (!priced) return result;
  const rateNum = parseFloat(priced.conversionRate);
  return {
    ...result,
    conversionRate: priced.conversionRate,
    inverseRate: rateNum > 0 ? String(1 / rateNum) : result.inverseRate,
  };
}
