/**
 * Core: get onramp rate (fiat → crypto). Uses Currency API for rates (RAMP_ARCHITECTURE).
 * Spec §4.1 GET /onramps/rates. LP is not the source of rates.
 */

import type { GetOnrampRatesResponse } from '../../types/onramp';

const DEFAULT_RATE = '1.00';

export interface GetOnrampRateOptions {
  /** Fetches rate from Currency API (exchange-rates-api.md). When set, used as sole rate source. */
  getRateFromCurrencyApi?: (from: string, to: string) => Promise<GetOnrampRatesResponse | null>;
}

/**
 * Get conversion rate for fromCurrency → toCurrency.
 * Uses Currency API when getRateFromCurrencyApi is provided; otherwise returns default rate.
 */
export async function getOnrampRate(
  fromCurrency: string,
  toCurrency: string,
  options: GetOnrampRateOptions | null
): Promise<GetOnrampRatesResponse> {
  const opts = (options && typeof options === 'object' ? options : null) ?? {};
  const from = (fromCurrency ?? '').trim().toLowerCase();
  const to = (toCurrency ?? '').trim().toLowerCase();
  if (!from || !to) {
    return {
      fromCurrency: from || fromCurrency,
      toCurrency: to || toCurrency,
      conversionRate: DEFAULT_RATE,
    };
  }
  if (opts.getRateFromCurrencyApi) {
    const result = await opts.getRateFromCurrencyApi(from, to);
    if (result) return result;
  }
  return {
    fromCurrency: from,
    toCurrency: to,
    conversionRate: DEFAULT_RATE,
  };
}
