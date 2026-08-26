/**
 * Core: get offramp rate (crypto → fiat). Palremit Currency API + optional
 * live executable floor (OwlPay effective_rate) so we never sell more fiat
 * per crypto than the payout provider will fund.
 */

import type { GetOfframpRatesResponse } from '@/types/offramp';
import { applyPairMarkupIfMatched, findPairMarkup } from '@/core/quotes/pairMarkup';
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
  /** Dest-fixed provider rate (EUR per USDC). Floor the mid at this before 25 bps. */
  executableRate?: number | null;
  /** When the pair has a markup rule (EUR), refuse to quote without an executable rate. */
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

  const rawMarket = parseFloat(String(result.marketRate ?? result.conversionRate));
  const apiMarket = Number.isFinite(rawMarket) && rawMarket > 0 ? rawMarket : 0;
  const executable = isUsableExecutableRate(opts.executableRate) ? opts.executableRate : null;
  if (findPairMarkup(from, to) && opts.requireExecutable && executable == null) {
    throw new Error('PALREMIT_RATES_UNAVAILABLE');
  }
  const priced = applyPairMarkupIfMatched({
    fromCurrency: from,
    toCurrency: to,
    amount: 1,
    marketRate: apiMarket > 0 ? floorOfframpMarketRate(apiMarket, executable) : result.marketRate,
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
