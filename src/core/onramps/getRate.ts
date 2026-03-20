/**
 * Core: get onramp rate (fiat → crypto). Palremit Currency API only (palremit_rates_guide.md).
 */

import type { GetOnrampRatesResponse } from '@/types/onramp';

export interface GetOnrampRateOptions {
  getRateFromPalremit?: (from: string, to: string) => Promise<GetOnrampRatesResponse | null>;
}

/**
 * Get conversion rate for fromCurrency → toCurrency. Palremit only; throws if unavailable.
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
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  if (!opts.getRateFromPalremit) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const result = await opts.getRateFromPalremit(from, to);
  if (!result?.conversionRate) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  return {
    ...result,
    conversionRates: result.conversionRates ?? [],
  };
}
