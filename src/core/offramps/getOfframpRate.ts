/**
 * Core: get offramp rate (crypto → fiat). Uses Currency API for rates (RAMP_ARCHITECTURE).
 * Spec §5.1 GET /offramps/rates. LP is not the source of rates.
 */

import type { GetOfframpRatesResponse } from '../../types/offramp';

const DEFAULT_RATE = '1.00';

export interface GetOfframpRateOptions {
  /** Fetches rate from Currency API. When set, used as sole rate source. */
  getRateFromCurrencyApi?: (
    from: string,
    to: string,
    fromChain?: string
  ) => Promise<GetOfframpRatesResponse | null>;
}

/**
 * Get conversion rate for fromCurrency (crypto) → toCurrency (fiat).
 * Uses Currency API when getRateFromCurrencyApi is provided; otherwise returns default rate.
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
    return {
      fromCurrency: from || fromCurrency,
      toCurrency: to || toCurrency,
      fromChain: chain,
      rate: DEFAULT_RATE,
      inverseRate: DEFAULT_RATE,
    };
  }

  if (opts.getRateFromCurrencyApi) {
    const result = await opts.getRateFromCurrencyApi(from, to, chain);
    if (result) return result;
  }

  return {
    fromCurrency: from,
    toCurrency: to,
    fromChain: chain,
    rate: DEFAULT_RATE,
    inverseRate: DEFAULT_RATE,
  };
}
