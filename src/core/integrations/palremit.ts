/**
 * Palremit LP integration. Maps Palremit APIs to our DTOs.
 * - Rates: currency-api.palremit.com (GET /pairs, POST /pairs/conversion)
 * - Liquidity: liquidity-api.palremit.com (ramp, deposits, withdrawals)
 * No Express/Prisma here. HTTP is injected so core does not import services.
 */

import type { GetOnrampRatesResponse } from '@/types/onramp';
import type { GetOfframpRatesResponse } from '@/types/offramp';

/** Currency API conversion response data */
interface PalremitConversionData {
  rate?: string | number;
  conversion?: number;
  marketRate?: string | number;
  rateCurrency?: string;
  perCurrency?: string;
  symbol?: string;
  side?: string;
}

export interface PalremitCurrencyRequestFn {
  <T>(path: string, options?: { method?: string; body?: unknown }): Promise<{
    status: number;
    data: { status: string; data: T | null };
  }>;
}

/** BloxFi uses Palremit B2B pricing on all `/pairs/conversion` calls. */
function palremitConversionBody(from: string, to: string, amount: number): Record<string, unknown> {
  return { from, to, amount, b2b: true };
}

/**
 * Fetch onramp rate from Palremit Currency API.
 * Uses POST /pairs/conversion with amount=1 to get rate for fromCurrency → toCurrency.
 * currencyRequest is injected (implemented by services/palremitClient).
 * Returns null if pair not supported or API error.
 */
export async function getPalremitOnrampRates(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string
): Promise<GetOnrampRatesResponse | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  if (!from || !to) return null;

  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: palremitConversionBody(from, to, 1),
  });
  if (res.status !== 200 || !res.data?.data) return null;
  if (res.data.status !== 'success') return null;

  const d = res.data.data;
  const rate =
    typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rate == null || rate === '') return null;

  const marketRate =
    typeof d.marketRate === 'string' ? d.marketRate : d.marketRate != null ? String(d.marketRate) : undefined;

  return {
    fromCurrency: from.toLowerCase(),
    toCurrency: to.toLowerCase(),
    conversionRate: rate,
    ...(marketRate ? { marketRate } : {}),
    ...(d.rateCurrency ? { rateCurrency: d.rateCurrency } : {}),
    ...(d.perCurrency ? { perCurrency: d.perCurrency } : {}),
  };
}

export interface GetOnrampQuoteResponse extends GetOnrampRatesResponse {
  /** Amount of `toCurrency` returned by Palremit for the requested `amount`. */
  conversion: number;
}

/**
 * Fetch an onramp quote from Palremit Currency API for an explicit amount.
 * Prefer this for onramp creation to avoid applying `rate` manually.
 */
export async function getPalremitOnrampQuote(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string,
  amount: number
): Promise<GetOnrampQuoteResponse | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  const amt = typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : 1;
  if (!from || !to) return null;

  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: palremitConversionBody(from, to, amt),
  });
  if (res.status !== 200 || !res.data?.data) return null;
  if (res.data.status !== 'success') return null;

  const d = res.data.data;
  const rate =
    typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rate == null || rate === '') return null;
  if (typeof d.conversion !== 'number' || !Number.isFinite(d.conversion)) return null;

  const marketRate =
    typeof d.marketRate === 'string' ? d.marketRate : d.marketRate != null ? String(d.marketRate) : undefined;

  return {
    fromCurrency: from.toLowerCase(),
    toCurrency: to.toLowerCase(),
    conversionRate: rate,
    conversion: d.conversion,
    ...(marketRate ? { marketRate } : {}),
    ...(d.rateCurrency ? { rateCurrency: d.rateCurrency } : {}),
    ...(d.perCurrency ? { perCurrency: d.perCurrency } : {}),
  };
}

/**
 * Fetch offramp rate (crypto → fiat) from Palremit Currency API.
 * Uses POST /pairs/conversion with amount=1; returns rate and inverseRate.
 */
export async function getPalremitOfframpRates(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string,
  fromChain?: string
): Promise<GetOfframpRatesResponse | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  if (!from || !to) return null;

  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: palremitConversionBody(from, to, 1),
  });
  if (res.status !== 200 || !res.data?.data) return null;
  if (res.data.status !== 'success') return null;

  const d = res.data.data;
  const rateStr =
    typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rateStr == null || rateStr === '') return null;
  const rateNum = parseFloat(rateStr);
  const inverseRate = rateNum > 0 ? String(1 / rateNum) : '0';

  const marketRate =
    typeof d.marketRate === 'string' ? d.marketRate : d.marketRate != null ? String(d.marketRate) : undefined;

  return {
    fromCurrency: from.toLowerCase(),
    toCurrency: to.toLowerCase(),
    fromChain: fromChain?.trim() || undefined,
    conversionRate: rateStr,
    inverseRate,
    rateValidUntil: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    minimumAmount: '10.00',
    maximumAmount: '50000.00',
    estimatedProcessingTime: '1-3 business days',
    availableRails: [],
    ...(marketRate ? { marketRate } : {}),
    ...(d.rateCurrency ? { rateCurrency: d.rateCurrency } : {}),
    ...(d.perCurrency ? { perCurrency: d.perCurrency } : {}),
  };
}

/**
 * Generic Currency API conversion: returns the orientation-safe output amount
 * (`conversion`) for `amount` units of `from` → `to`. Null on any failure.
 */
export async function getPalremitConversionAmount(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string,
  amount: number
): Promise<number | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  if (!from || !to || !Number.isFinite(amount) || amount <= 0) return null;
  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: palremitConversionBody(from, to, amount),
  });
  if (res.status !== 200 || res.data?.status !== 'success' || !res.data?.data) return null;
  const c = res.data.data.conversion;
  return typeof c === 'number' && Number.isFinite(c) ? c : null;
}
