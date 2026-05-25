/**
 * Structured logging for outbound provider HTTP calls (audit + debugging).
 * Provider clients (e.g. palremitClient) call these helpers; business layers stay free of I/O logs.
 */

import { logger } from '@/lib/logger';

export const PROVIDER_API_LOG_MAX_LEN = 2000;

export type ProviderName = 'palremit';

export interface ProviderApiLogFields {
  provider: ProviderName;
  api: string;
  method: string;
  path: string;
  url: string;
  operation: string;
  logCategory?: string;
  requestPayload?: unknown;
  idempotencyKey?: string;
  hasAuth?: boolean;
  authScheme?: string;
}

export function truncateForProviderLog(
  value: unknown,
  maxLen = PROVIDER_API_LOG_MAX_LEN
): unknown {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  if (raw.length <= maxLen) return value;
  return `${raw.slice(0, maxLen)}…`;
}

function baseLogObject(fields: ProviderApiLogFields): Record<string, unknown> {
  return {
    provider: fields.provider,
    api: fields.api,
    method: fields.method,
    path: fields.path,
    url: fields.url,
    logCategory: fields.logCategory,
    operation: fields.operation,
    requestPayload: truncateForProviderLog(fields.requestPayload),
    idempotencyKey: fields.idempotencyKey,
    hasAuth: fields.hasAuth,
    authScheme: fields.authScheme,
  };
}

/** Log a successful provider HTTP response (2xx) with request + response bodies. */
export function logProviderApiSuccess(
  fields: ProviderApiLogFields,
  opts: { httpStatus: number; responseBody: unknown; message: string }
): void {
  logger.info(
    {
      ...baseLogObject(fields),
      httpStatus: opts.httpStatus,
      responseBody: truncateForProviderLog(opts.responseBody),
    },
    opts.message
  );
}

/** Log a failed provider HTTP call (non-2xx or transport error) with request + error body. */
export function logProviderApiFailure(
  fields: ProviderApiLogFields,
  opts: {
    httpStatus?: number;
    responseBody?: unknown;
    providerMessage?: string;
    debug?: string;
    err?: unknown;
    message: string;
  }
): void {
  logger.error(
    {
      ...baseLogObject(fields),
      httpStatus: opts.httpStatus,
      providerMessage: opts.providerMessage,
      responseBody: truncateForProviderLog(opts.responseBody),
      debug: opts.debug,
      err: opts.err,
    },
    opts.message
  );
}
