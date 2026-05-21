/**
 * Palremit API clients. No business logic; external I/O only.
 * - Currency API (currency-api.palremit.com): rates — GET /pairs, POST /pairs/conversion
 * - Liquidity Orchestrator: Bearer secret, /v1/* — default `https://liquidity.palremit.com` (override with `PALREMIT_LIQUIDITY_URL`).
 */

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import { httpRequest, type HttpError, type HttpRequestOptions, type HttpResponse } from '@/services/http';

const PALREMIT_TIMEOUT_MS = 15000;

/** Palremit envelope: { status, message, data } — Currency API + Liquidity `/v1/coins/*` (LegacyEnvelope) */
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
  const raw = env.PALREMIT_LIQUIDITY_URL?.trim();
  const base = raw ? raw.replace(/\/$/, '') : '';
  return base || 'https://liquidity.palremit.com';
}

function liquidityBearerAuthHeader(): string {
  return `Bearer ${env.PALREMIT_LIQUIDITY_SECRET.trim()}`;
}

function isHttpErrorWithStatus(e: unknown): e is HttpError & { data?: unknown } {
  return (
    e instanceof Error &&
    'status' in e &&
    typeof (e as { status: unknown }).status === 'number'
  );
}

function logPalremitRequestFailure(
  api: 'currency' | 'liquidity',
  method: string,
  url: string,
  error: unknown,
  meta?: {
    hasAuth?: boolean;
    authScheme?: string;
    idempotencyKey?: string;
  }
): void {
  if (isHttpErrorWithStatus(error)) {
    let preview = '';
    if (error.data !== undefined) {
      const raw =
        typeof error.data === 'string' ? error.data : JSON.stringify(error.data);
      preview = raw.length > 800 ? `${raw.slice(0, 800)}…` : raw;
    }
    const debugBits: string[] = [];
    if (meta?.hasAuth !== undefined) debugBits.push(`auth=${meta.hasAuth ? 'present' : 'missing'}`);
    if (meta?.authScheme) debugBits.push(`scheme=${meta.authScheme}`);
    if (meta?.idempotencyKey) debugBits.push('idempotency=present');
    const wwwAuth = error.headers?.['www-authenticate'];
    if (wwwAuth) debugBits.push(`www-authenticate=${wwwAuth}`);
    const reqId =
      error.headers?.['x-request-id'] ??
      error.headers?.['x-correlation-id'] ??
      error.headers?.['cf-ray'];
    if (reqId) debugBits.push(`req=${reqId}`);
    logger.error(
      {
        api,
        method,
        url,
        httpStatus: error.status,
        debug: debugBits.length ? debugBits.join(', ') : undefined,
        bodyPreview: preview || undefined,
      },
      'Palremit request failed'
    );
    return;
  }
  logger.error({ api, method, url, err: error }, 'Palremit request failed');
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
 * Request to Palremit Liquidity Orchestrator. Bearer secret; optional Idempotency-Key on writes.
 */
export async function palremitLiquidityRequest<T = unknown>(
  path: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const base = liquidityBase();
  const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Authorization: liquidityBearerAuthHeader(),
    ...(options.headers ?? {}),
  };
  const method = options.method ?? 'GET';
  try {
    return await httpRequest<T>(url, {
      ...options,
      headers,
      timeoutMs: options.timeoutMs ?? PALREMIT_TIMEOUT_MS,
    });
  } catch (e) {
    const authHeader = headers.Authorization;
    logPalremitRequestFailure('liquidity', method, url, e, {
      hasAuth: Boolean(authHeader && authHeader.trim()),
      authScheme: typeof authHeader === 'string' ? authHeader.split(/\s+/)[0] : undefined,
      idempotencyKey: headers['Idempotency-Key'],
    });
    throw e;
  }
}

export function isPalremitConfigured(): boolean {
  return Boolean(env.PALREMIT_LIQUIDITY_SECRET);
}
