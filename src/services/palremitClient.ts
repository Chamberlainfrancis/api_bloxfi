/**
 * Palremit API clients. No business logic; external I/O only.
 * - Currency API (currency-api.palremit.com): rates — GET /pairs, POST /pairs/conversion
 * - Liquidity API (liquidity-api.palremit.com): ramp, deposits, withdrawals — access_key header
 */

import { env } from '../config/env';
import { httpRequest, type HttpRequestOptions, type HttpResponse } from './http';

const PALREMIT_TIMEOUT_MS = 15000;

/** Palremit envelope: { status, message, data } */
export interface PalremitEnvelope<T = unknown> {
  status: 'success' | 'error';
  message?: string;
  data: T | null;
}

function currencyBase(): string {
  const base = env.PALREMIT_CURRENCY_URL?.replace(/\/$/, '');
  return base ?? 'https://currency-api.palremit.com';
}

function liquidityBase(): string {
  const base = env.PALREMIT_LIQUIDITY_URL?.replace(/\/$/, '');
  return base ?? 'https://liquidity-api.palremit.com';
}

function liquidityHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  const key = env.PALREMIT_ACCESS_KEY;
  if (key) {
    headers['access_key'] = key;
  }
  return headers;
}

/**
 * Request to Palremit Currency API (rates). No auth per docs.
 */
export async function palremitCurrencyRequest<T = unknown>(
  path: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<PalremitEnvelope<T>>> {
  const base = currencyBase();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  return httpRequest<PalremitEnvelope<T>>(url, {
    ...options,
    timeoutMs: options.timeoutMs ?? PALREMIT_TIMEOUT_MS,
  });
}

/**
 * Request to Palremit Liquidity API (ramp, deposits, withdrawals). Uses access_key header.
 */
export async function palremitLiquidityRequest<T = unknown>(
  path: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<PalremitEnvelope<T>>> {
  const base = liquidityBase();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = liquidityHeaders(options.headers);
  return httpRequest<PalremitEnvelope<T>>(url, {
    ...options,
    headers,
    timeoutMs: options.timeoutMs ?? PALREMIT_TIMEOUT_MS,
  });
}

export function isPalremitConfigured(): boolean {
  return Boolean(env.PALREMIT_CURRENCY_URL ?? env.PALREMIT_LIQUIDITY_URL);
}
