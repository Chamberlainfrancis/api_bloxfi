/**
 * Palremit API clients. No business logic; external I/O only.
 * - Currency API (currency-api.palremit.com): rates — GET /pairs, POST /pairs/conversion
 * - Liquidity API (liquidity-api.palremit.com): ramp, deposits, withdrawals — access_key header
 */

import { env } from '@/config/env';
import { httpRequest, type HttpRequestOptions, type HttpResponse } from '@/services/http';

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

function isHttpErrorWithStatus(e: unknown): e is Error & { status: number; data?: unknown } {
  return (
    e instanceof Error &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number'
  );
}

/** Logs failing Palremit URL for debugging (remove or gate behind env when stable). */
function logPalremitRequestFailure(
  api: 'currency' | 'liquidity',
  method: string,
  url: string,
  error: unknown
): void {
  if (isHttpErrorWithStatus(error)) {
    let preview = '';
    if (error.data !== undefined) {
      const raw =
        typeof error.data === 'string' ? error.data : JSON.stringify(error.data);
      preview = raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
    }
    console.error(
      `[Palremit ${api}] ${method} ${url} → HTTP ${error.status}${preview ? ` body=${preview}` : ''}`
    );
    return;
  }
  console.error(`[Palremit ${api}] ${method} ${url} →`, error);
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
  const method = options.method ?? 'GET';
  try {
    return await httpRequest<PalremitEnvelope<T>>(url, {
      ...options,
      timeoutMs: options.timeoutMs ?? PALREMIT_TIMEOUT_MS,
    });
  } catch (e) {
    logPalremitRequestFailure('currency', method, url, e);
    throw e;
  }
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
  const method = options.method ?? 'GET';
  try {
    return await httpRequest<PalremitEnvelope<T>>(url, {
      ...options,
      headers,
      timeoutMs: options.timeoutMs ?? PALREMIT_TIMEOUT_MS,
    });
  } catch (e) {
    logPalremitRequestFailure('liquidity', method, url, e);
    throw e;
  }
}

export function isPalremitConfigured(): boolean {
  return Boolean(env.PALREMIT_LIQUIDITY_URL && env.PALREMIT_ACCESS_KEY);
}
