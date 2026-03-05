/**
 * LP (liquidity provider) HTTP client. Service layer for outbound calls to LPs.
 * Used only by /core/integrations. No business logic; external I/O only.
 * User creation is not delegated to LPs — all user/KYB is handled locally.
 *
 * When PALREMIT_LIQUIDITY_URL is set, lpClient uses Palremit as the LP.
 * Otherwise LP_BASE_URL is used for a generic BloxFi-style LP.
 */

import { env } from '../config/env';
import { httpRequest, type HttpRequestOptions, type HttpResponse } from './http';
import { palremitLiquidityRequest } from './palremitClient';
import type { LpHttpClient } from '../core/integrations/types';

const LP_TIMEOUT_MS = 15000;

/**
 * Build request headers for LP calls (optional Bearer token from env).
 */
function lpHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers = { ...extra };
  if (env.LP_API_KEY) {
    headers['Authorization'] = `Bearer ${env.LP_API_KEY}`;
  }
  return headers;
}

/**
 * Resolve LP request URL: if LP_BASE_URL is set, path is appended; otherwise path is used as full URL.
 */
function resolveUrl(path: string): string {
  const base = env.LP_BASE_URL?.replace(/\/$/, '');
  if (base) {
    const p = path.startsWith('/') ? path : `/${path}`;
    return `${base}${p}`;
  }
  return path;
}

/**
 * Send HTTP request to a generic LP. Uses LP_BASE_URL + path when LP_BASE_URL is set;
 * otherwise path must be a full URL. Adds LP_API_KEY as Bearer when set.
 */
export async function lpRequest<T = unknown>(
  path: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const url = resolveUrl(path);
  const timeoutMs = options.timeoutMs ?? LP_TIMEOUT_MS;
  const headers = lpHeaders(options.headers);
  return httpRequest<T>(url, {
    ...options,
    headers,
    timeoutMs,
  });
}

/**
 * Palremit Liquidity API as LpHttpClient. Unwraps Palremit envelope so callers get response data directly.
 */
const palremitLpClient: LpHttpClient = {
  async request<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>> {
    const res = await palremitLiquidityRequest(path, options ?? {});
    const data = (res.data && typeof res.data === 'object' && 'data' in res.data
      ? (res.data as { data: T }).data
      : res.data) as T;
    return { status: res.status, headers: res.headers, data };
  },
};

/**
 * LP client for ramp liquidity. Uses Palremit when PALREMIT_LIQUIDITY_URL is set; otherwise generic LP when LP_BASE_URL is set.
 */
export function getLpClient(): LpHttpClient | null {
  if (env.PALREMIT_LIQUIDITY_URL) return palremitLpClient;
  if (env.LP_BASE_URL) return { request: lpRequest };
  return null;
}

export type { HttpRequestOptions, HttpResponse };
