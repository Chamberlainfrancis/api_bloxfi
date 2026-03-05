/**
 * LP integration for onramp: rates and create. Maps our DTOs to LP requests; normalizes LP responses.
 * Used by core/onramps when LP is configured. No Express/Prisma here.
 */

import type { LpHttpClient } from './types';
import type {
  GetOnrampRatesResponse,
  CreateOnrampRequest,
  OnrampResponse,
  DepositInfo,
  QuoteInformation,
  OnrampSource,
  OnrampDestination,
  OnrampStatus,
} from '../../types/onramp';

/** LP response shape for GET /onramps/rates (normalize from LP-specific format). */
export interface LpRatesResponse {
  fromCurrency?: string;
  toCurrency?: string;
  conversionRate?: string;
  conversionRates?: Array<{ transferType: string; conversionRate: string }>;
}

/** LP response shape for POST /onramps (normalize from LP-specific format). */
export interface LpCreateOnrampResponse {
  transferType?: string;
  transferDetails?: {
    id?: string;
    requestId?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    source?: unknown;
    destination?: unknown;
    quoteInformation?: unknown;
    depositInfo?: unknown;
    receipt?: unknown;
    developerFee?: unknown;
    failedReason?: string;
  };
}

function toIso(d: Date | string | undefined): string {
  if (!d) return new Date().toISOString();
  return typeof d === 'string' ? d : d.toISOString();
}

/**
 * Normalize LP rates response to our GetOnrampRatesResponse.
 */
export function normalizeLpRates(
  fromCurrency: string,
  toCurrency: string,
  lp: LpRatesResponse
): GetOnrampRatesResponse {
  return {
    fromCurrency: lp.fromCurrency ?? fromCurrency,
    toCurrency: lp.toCurrency ?? toCurrency,
    conversionRate: lp.conversionRate ?? '1.00',
    conversionRates: lp.conversionRates,
  };
}

/**
 * Normalize LP create-onramp response to our OnrampResponse.
 */
export function normalizeLpCreateOnramp(
  lp: LpCreateOnrampResponse,
  requestId: string
): OnrampResponse | null {
  const td = lp.transferDetails;
  if (!td) return null;
  const source = td.source as OnrampSource | undefined;
  const destination = td.destination as OnrampDestination | undefined;
  const quoteInformation = td.quoteInformation as QuoteInformation | undefined;
  const depositInfo = td.depositInfo as DepositInfo | undefined;
  return {
    transferType: 'ONRAMP',
    transferDetails: {
      id: td.id ?? '',
      requestId: td.requestId ?? requestId,
      status: (td.status as OnrampStatus) ?? 'CREATED',
      createdAt: toIso(td.createdAt),
      updatedAt: toIso(td.updatedAt),
      source: source ?? ({} as OnrampSource),
      destination: destination ?? ({} as OnrampDestination),
      quoteInformation: quoteInformation ?? ({} as QuoteInformation),
      depositInfo: depositInfo ?? null,
      receipt:
        td.receipt && typeof (td.receipt as { transactionHash?: string }).transactionHash === 'string'
          ? { transactionHash: (td.receipt as { transactionHash: string }).transactionHash }
          : null,
      developerFee: td.developerFee as { amount: string; currency: string } | undefined ?? null,
      failedReason: td.failedReason ?? null,
    },
  };
}

/**
 * Fetch onramp rates from LP. Path and body are LP-specific; we use spec-aligned paths.
 * Returns null if LP call fails or LP not configured (caller should use default rate).
 */
export async function getOnrampRatesFromLp(
  lpClient: LpHttpClient,
  fromCurrency: string,
  toCurrency: string
): Promise<GetOnrampRatesResponse | null> {
  try {
    const path = `/onramps/rates?fromCurrency=${encodeURIComponent(fromCurrency)}&toCurrency=${encodeURIComponent(toCurrency)}`;
    const res = await lpClient.request<LpRatesResponse>(path, { method: 'GET' });
    if (res.status >= 200 && res.status < 300 && res.data) {
      return normalizeLpRates(fromCurrency, toCurrency, res.data);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create onramp at LP. Sends our CreateOnrampRequest shape; normalizes response.
 * Returns null if LP call fails (caller should create locally only).
 */
export async function createOnrampAtLp(
  lpClient: LpHttpClient,
  payload: CreateOnrampRequest
): Promise<OnrampResponse | null> {
  try {
    const res = await lpClient.request<LpCreateOnrampResponse>('/onramps', {
      method: 'POST',
      body: payload,
    });
    if (res.status >= 200 && res.status < 300 && res.data) {
      return normalizeLpCreateOnramp(res.data, payload.requestId);
    }
    return null;
  } catch {
    return null;
  }
}
