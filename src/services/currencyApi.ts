/**
 * Currency API client for exchange rates (docs/exchange-rates-api.md).
 * Used by ramp logic for all rate and conversion; LP is not the source of rates.
 * Base URL: CURRENCY_API_URL or PALREMIT_CURRENCY_URL.
 */

import { env } from '../config/env';
import { httpRequest, type HttpRequestOptions } from './http';

const CURRENCY_API_TIMEOUT_MS = 15000;

export interface CurrencyApiEnvelope<T = unknown> {
  status: 'success' | 'error';
  message?: string;
  data: T | null;
}

/** POST /pairs/conversion response data */
export interface ConversionData {
  rate: string | number;
  conversion: number;
  rateCurrency?: string;
  perCurrency?: string;
  marketRate?: string;
  symbol?: string;
  side?: string;
}

/** GET /pairs?pair=XXX response data (single pair) */
export interface PairData {
  pair: string;
  buy: number;
  sell: number;
  b2b_buy?: number;
  b2b_sell?: number;
  active: boolean;
}

function baseUrl(): string | null {
  const url = env.CURRENCY_API_URL ?? env.PALREMIT_CURRENCY_URL;
  if (!url) return null;
  return url.replace(/\/$/, '');
}

/**
 * Call Currency API. Returns null if base URL not configured or request fails.
 */
async function currencyApiRequest<T>(
  path: string,
  options: HttpRequestOptions = {}
): Promise<{ status: number; data: CurrencyApiEnvelope<T> } | null> {
  const base = baseUrl();
  if (!base) return null;
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  try {
    const res = await httpRequest<CurrencyApiEnvelope<T>>(url, {
      ...options,
      timeoutMs: options.timeoutMs ?? CURRENCY_API_TIMEOUT_MS,
    });
    return { status: res.status, data: res.data };
  } catch {
    return null;
  }
}

/**
 * Convert amount from one currency to another (POST /pairs/conversion).
 * Returns rate (string) and conversion (number), or null if API not configured or pair not found.
 */
export async function getConversion(
  from: string,
  to: string,
  amount: number,
  options?: { inverse?: boolean; b2b?: boolean }
): Promise<{ rate: string; conversion: number } | null> {
  const fromNorm = (from ?? '').trim().toUpperCase();
  const toNorm = (to ?? '').trim().toUpperCase();
  if (!fromNorm || !toNorm || amount <= 0) return null;

  const res = await currencyApiRequest<ConversionData>('/pairs/conversion', {
    method: 'POST',
    body: {
      from: fromNorm,
      to: toNorm,
      amount,
      inverse: options?.inverse ?? false,
      b2b: options?.b2b ?? false,
    },
  });
  if (!res || res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  const d = res.data.data;
  const rate = typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rate == null) return null;
  return { rate, conversion: d.conversion };
}

/**
 * Get rate for fromCurrency → toCurrency (conversion of 1 unit).
 * Used by onramp/offramp to get conversion rate from Currency API only.
 */
export async function getRate(
  fromCurrency: string,
  toCurrency: string
): Promise<{ rate: string; inverseRate: string } | null> {
  const result = await getConversion(fromCurrency, toCurrency, 1);
  if (!result) return null;
  const rateNum = parseFloat(result.rate) || 0;
  const inverseRate = rateNum > 0 ? String(1 / rateNum) : '0';
  return { rate: result.rate, inverseRate };
}

/**
 * Whether the Currency API is configured (for rates).
 */
export function isCurrencyApiConfigured(): boolean {
  return Boolean(baseUrl());
}
