/**
 * Core: get offramp rate (crypto → fiat). Palremit Currency API + optional
 * live executable floor (OwlPay effective_rate) so we never sell more fiat
 * per crypto than the payout provider will fund.
 */

import type { GetOfframpRatesResponse } from '@/types/offramp';
import { applyRequiredOfframpPairMarkup, requireOfframpPairMarkup } from '@/core/quotes/pairMarkup';
import {
  floorOfframpMarketRate,
  isUsableExecutableRate,
} from '@/core/quotes/floorOfframpMarketRate';

export interface GetOfframpRateOptions {
  getRateFromPalremit?: (
    from: string,
    to: string,
    fromChain?: string
  ) => Promise<GetOfframpRatesResponse | null>;
  /** Dest-fixed provider rate (fiat per USDC). Floor the served rate at this. */
  executableRate?: number | null;
  /** Refuse to quote without an executable rate (when the pair's markup row asks for one). */
  requireExecutable?: boolean;
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

  // Throws RATE_MARKUP_NOT_SET when the pair has no saved sell markup.
  const rule = requireOfframpPairMarkup(from, to);
  const rawMarket = parseFloat(String(result.marketRate ?? result.conversionRate));
  const apiMarket = Number.isFinite(rawMarket) && rawMarket > 0 ? rawMarket : 0;
  const executable = isUsableExecutableRate(opts.executableRate) ? opts.executableRate : null;
  if (rule.requireProviderRate && opts.requireExecutable && executable == null) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const priced = applyRequiredOfframpPairMarkup({
    fromCurrency: from,
    toCurrency: to,
    amount: 1,
    marketRate: apiMarket > 0 ? floorOfframpMarketRate(apiMarket, executable) : result.marketRate,
    rateCurrency: result.rateCurrency,
    perCurrency: result.perCurrency,
  });
  const rateNum = parseFloat(priced.conversionRate);
  return {
    ...result,
    conversionRate: priced.conversionRate,
    inverseRate: rateNum > 0 ? String(1 / rateNum) : result.inverseRate,
  };
}
