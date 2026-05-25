/**
 * Palremit API clients. No business logic; external I/O only.
 * - Currency API (currency-api.palremit.com): rates — GET /pairs, POST /pairs/conversion
 * - Liquidity Orchestrator: Bearer secret, /v1/* — default `https://liquidity.palremit.com` (override with `PALREMIT_LIQUIDITY_URL`).
 */

import { env } from '@/config/env';
import {
  buildPalremitFailureLogMsg,
  buildPalremitInfoLogMsg,
  extractPalremitErrorMessage,
  getPalremitLogCategory,
} from '@/services/palremitErrorMessage';
import {
  logProviderApiFailure,
  logProviderApiSuccess,
  type ProviderApiLogFields,
} from '@/services/providerApiLog';
import { httpRequest, type HttpError, type HttpRequestOptions, type HttpResponse } from '@/services/http';

export {
  buildPalremitFailureLogMsg,
  buildPalremitInfoLogMsg,
  extractPalremitErrorMessage,
  formatPalremitErrorBodyForLog,
  getPalremitLogCategory,
} from '@/services/palremitErrorMessage';

const PALREMIT_TIMEOUT_MS = 15000;
const PALREMIT_PROVIDER = 'palremit' as const;

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

function buildPalremitLogFields(
  api: 'currency' | 'liquidity',
  method: string,
  url: string,
  requestBody: unknown,
  meta?: {
    idempotencyKey?: string;
    hasAuth?: boolean;
    authScheme?: string;
  }
): ProviderApiLogFields {
  const path = pathFromUrl(url);
  const logCategory = getPalremitLogCategory({
    api,
    method,
    path,
    idempotencyKey: meta?.idempotencyKey,
  });
  return {
    provider: PALREMIT_PROVIDER,
    api,
    method,
    path,
    url,
    logCategory,
    operation: `${method} ${path}`,
    requestPayload: requestBody,
    idempotencyKey: meta?.idempotencyKey,
    hasAuth: meta?.hasAuth,
    authScheme: meta?.authScheme,
  };
}

function httpFailureDebugBits(
  error: HttpError,
  meta?: { hasAuth?: boolean; authScheme?: string }
): string | undefined {
  const debugBits: string[] = [];
  if (meta?.hasAuth !== undefined) {
    debugBits.push(`auth=${meta.hasAuth ? 'present' : 'missing'}`);
  }
  if (meta?.authScheme) debugBits.push(`scheme=${meta.authScheme}`);
  const wwwAuth = error.headers?.['www-authenticate'];
  if (wwwAuth) debugBits.push(`www-authenticate=${wwwAuth}`);
  const reqId =
    error.headers?.['x-request-id'] ??
    error.headers?.['x-correlation-id'] ??
    error.headers?.['cf-ray'];
  if (reqId) debugBits.push(`req=${reqId}`);
  return debugBits.length ? debugBits.join(', ') : undefined;
}

function logPalremitHttpFailure(
  fields: ProviderApiLogFields,
  error: unknown,
  meta?: { hasAuth?: boolean; authScheme?: string }
): void {
  if (isHttpErrorWithStatus(error)) {
    const palremitMessage = extractPalremitErrorMessage(error.data);
    logProviderApiFailure(fields, {
      httpStatus: error.status,
      responseBody: error.data,
      providerMessage: palremitMessage,
      debug: httpFailureDebugBits(error, meta),
      message: buildPalremitFailureLogMsg({
        category: fields.logCategory ?? 'Palremit',
        responseData: error.data,
        method: fields.method,
        path: fields.path,
        httpStatus: error.status,
      }),
    });
    return;
  }

  const errMsg = error instanceof Error ? error.message : undefined;
  logProviderApiFailure(fields, {
    providerMessage: errMsg,
    err: error,
    message: buildPalremitFailureLogMsg({
      category: fields.logCategory ?? 'Palremit',
      method: fields.method,
      path: fields.path,
      responseData: errMsg,
    }),
  });
}

async function executePalremitRequest<T>(
  api: 'currency' | 'liquidity',
  url: string,
  options: HttpRequestOptions,
  meta?: {
    idempotencyKey?: string;
    hasAuth?: boolean;
    authScheme?: string;
  }
): Promise<HttpResponse<T>> {
  const method = options.method ?? 'GET';
  const fields = buildPalremitLogFields(api, method, url, options.body, meta);
  try {
    const response = await httpRequest<T>(url, {
      ...options,
      timeoutMs: options.timeoutMs ?? PALREMIT_TIMEOUT_MS,
    });
    logProviderApiSuccess(fields, {
      httpStatus: response.status,
      responseBody: response.data,
      message: buildPalremitInfoLogMsg(fields.logCategory ?? 'Palremit', 'response'),
    });
    return response;
  } catch (e) {
    logPalremitHttpFailure(fields, e, meta);
    throw e;
  }
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
  return executePalremitRequest<PalremitEnvelope<T>>('currency', url, options);
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
  const authHeader = headers.Authorization;
  return executePalremitRequest<T>(
    'liquidity',
    url,
    { ...options, headers },
    {
      idempotencyKey: headers['Idempotency-Key'],
      hasAuth: Boolean(authHeader?.trim()),
      authScheme: typeof authHeader === 'string' ? authHeader.split(/\s+/)[0] : undefined,
    }
  );
}

export function isPalremitConfigured(): boolean {
  return Boolean(env.PALREMIT_LIQUIDITY_SECRET);
}
