/**
 * Palremit API clients. No business logic; external I/O only.
 * - Currency API (currency-api.palremit.com): rates — GET /pairs, POST /pairs/conversion
 * - Liquidity Orchestrator: Bearer secret, /v1/* — default `https://liquidity.palremit.com` (override with `PALREMIT_LIQUIDITY_URL`).
 */

import { env } from '@/config/env';
import { logger } from '@/lib/logger';
import {
  buildPalremitFailureLogMsg,
  extractPalremitErrorMessage,
  getPalremitLogCategory,
} from '@/services/palremitErrorMessage';
import { httpRequest, type HttpError, type HttpRequestOptions, type HttpResponse } from '@/services/http';

export {
  buildPalremitFailureLogMsg,
  buildPalremitInfoLogMsg,
  extractPalremitErrorMessage,
  formatPalremitErrorBodyForLog,
  getPalremitLogCategory,
} from '@/services/palremitErrorMessage';

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

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function truncateForLog(value: unknown, maxLen = 2000): unknown {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw.length <= maxLen) return value;
  return `${raw.slice(0, maxLen)}…`;
}

function logPalremitRequestFailure(
  api: 'currency' | 'liquidity',
  method: string,
  url: string,
  error: unknown,
  meta?: {
    requestBody?: unknown;
    hasAuth?: boolean;
    authScheme?: string;
    idempotencyKey?: string;
  }
): void {
  const path = pathFromUrl(url);
  const logCategory = getPalremitLogCategory({
    api,
    method,
    path,
    idempotencyKey: meta?.idempotencyKey,
  });
  const baseFields = {
    api,
    method,
    path,
    url,
    logCategory,
    requestPayload: truncateForLog(meta?.requestBody),
    idempotencyKey: meta?.idempotencyKey,
  };

  if (isHttpErrorWithStatus(error)) {
    const palremitMessage = extractPalremitErrorMessage(error.data);
    const msg = buildPalremitFailureLogMsg({
      category: logCategory,
      responseData: error.data,
      method,
      path,
      httpStatus: error.status,
    });

    let responseBody: unknown = error.data;
    if (error.data !== undefined) {
      const raw =
        typeof error.data === 'string' ? error.data : JSON.stringify(error.data);
      responseBody =
        raw.length > 2000 ? `${raw.slice(0, 2000)}…` : error.data;
    }
    const debugBits: string[] = [];
    if (meta?.hasAuth !== undefined) debugBits.push(`auth=${meta.hasAuth ? 'present' : 'missing'}`);
    if (meta?.authScheme) debugBits.push(`scheme=${meta.authScheme}`);
    const wwwAuth = error.headers?.['www-authenticate'];
    if (wwwAuth) debugBits.push(`www-authenticate=${wwwAuth}`);
    const reqId =
      error.headers?.['x-request-id'] ??
      error.headers?.['x-correlation-id'] ??
      error.headers?.['cf-ray'];
    if (reqId) debugBits.push(`req=${reqId}`);
    logger.error(
      {
        ...baseFields,
        operation: `${method} ${path}`,
        httpStatus: error.status,
        palremitMessage,
        responseBody,
        debug: debugBits.length ? debugBits.join(', ') : undefined,
      },
      msg
    );
    return;
  }

  const errMsg = error instanceof Error ? error.message : undefined;
  const msg = buildPalremitFailureLogMsg({
    category: logCategory,
    method,
    path,
    responseData: errMsg,
  });
  logger.error(
    { ...baseFields, operation: `${method} ${path}`, palremitMessage: errMsg, err: error },
    msg
  );
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
    logPalremitRequestFailure('currency', method, url, e, { requestBody: options.body });
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
      requestBody: options.body,
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
