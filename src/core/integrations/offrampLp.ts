/**
 * LP integration for offramp: rates and create. Maps our DTOs to LP requests; normalizes LP responses.
 * Used by core/offramps when LP is configured. No Express/Prisma here.
 */

import type { LpHttpClient } from './types';
import type {
  GetOfframpRatesResponse,
  CreateOfframpRequest,
  OfframpResponse,
  DepositInstructions,
  RateInformation,
  OfframpSource,
  OfframpDestination,
  OfframpStatus,
  OfframpTransferDetails,
  RefundDetails,
} from '../../types/offramp';

/** LP response shape for GET /offramps/rates (normalize from LP-specific format). */
export interface LpOfframpRatesResponse {
  fromCurrency?: string;
  toCurrency?: string;
  fromChain?: string;
  rate?: string;
  inverseRate?: string;
  limits?: { minAmount?: string; maxAmount?: string; currency?: string };
  availableRails?: string[];
}

/** LP response shape for POST /offramps (normalize from LP-specific format). */
export interface LpCreateOfframpResponse {
  transferType?: string;
  transferDetails?: {
    id?: string;
    requestId?: string;
    status?: string;
    createdAt?: string;
    updatedAt?: string;
    source?: unknown;
    destination?: unknown;
    rateInformation?: unknown;
    depositInstructions?: unknown;
    timeline?: unknown;
    fees?: unknown;
    receipt?: unknown;
    refundDetails?: unknown;
    failedReason?: string;
  };
}

function toIso(d: Date | string | undefined): string {
  if (!d) return new Date().toISOString();
  return typeof d === 'string' ? d : d.toISOString();
}

/**
 * Normalize LP offramp rates response to our GetOfframpRatesResponse.
 */
export function normalizeLpOfframpRates(
  fromCurrency: string,
  toCurrency: string,
  fromChain: string | undefined,
  lp: LpOfframpRatesResponse
): GetOfframpRatesResponse {
  return {
    fromCurrency: lp.fromCurrency ?? fromCurrency,
    toCurrency: lp.toCurrency ?? toCurrency,
    fromChain: lp.fromChain ?? fromChain,
    rate: lp.rate ?? '1.00',
    inverseRate: lp.inverseRate ?? '1.00',
    limits: lp.limits,
    availableRails: lp.availableRails,
  };
}

/**
 * Normalize LP create-offramp response to our OfframpResponse.
 */
export function normalizeLpCreateOfframp(
  lp: LpCreateOfframpResponse,
  requestId: string
): OfframpResponse | null {
  const td = lp.transferDetails;
  if (!td) return null;
  const source = td.source as OfframpSource | undefined;
  const destination = td.destination as OfframpDestination | undefined;
  const rateInformation = td.rateInformation as RateInformation | undefined;
  const depositInstructions = td.depositInstructions as DepositInstructions | undefined;
  const transferDetails: OfframpTransferDetails = {
    id: td.id ?? '',
    requestId: td.requestId ?? requestId,
    status: (td.status as OfframpStatus) ?? 'CREATED',
    createdAt: toIso(td.createdAt),
    updatedAt: toIso(td.updatedAt),
    source: source ?? ({} as OfframpSource),
    destination: destination ?? ({} as OfframpDestination),
    rateInformation: rateInformation ?? ({} as RateInformation),
    depositInstructions: depositInstructions ?? null,
    receipt: td.receipt ?? null,
    refundDetails:
      td.refundDetails && typeof (td.refundDetails as RefundDetails).status === 'string'
        ? (td.refundDetails as RefundDetails)
        : null,
    failedReason: td.failedReason ?? null,
  };
  return {
    transferType: 'OFFRAMP',
    transferDetails,
  };
}

/**
 * Fetch offramp rates from LP. Returns null if LP call fails or LP not configured.
 */
export async function getOfframpRatesFromLp(
  lpClient: LpHttpClient,
  fromCurrency: string,
  toCurrency: string,
  fromChain?: string
): Promise<GetOfframpRatesResponse | null> {
  try {
    const params = new URLSearchParams({
      fromCurrency,
      toCurrency,
    });
    if (fromChain) params.set('fromChain', fromChain);
    const path = `/offramps/rates?${params.toString()}`;
    const res = await lpClient.request<LpOfframpRatesResponse>(path, { method: 'GET' });
    if (res.status >= 200 && res.status < 300 && res.data) {
      return normalizeLpOfframpRates(fromCurrency, toCurrency, fromChain, res.data);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Create offramp at LP. Sends our CreateOfframpRequest shape; normalizes response.
 * Returns null if LP call fails (caller should create locally only).
 */
export async function createOfframpAtLp(
  lpClient: LpHttpClient,
  payload: CreateOfframpRequest
): Promise<OfframpResponse | null> {
  try {
    const res = await lpClient.request<LpCreateOfframpResponse>('/offramps', {
      method: 'POST',
      body: payload,
    });
    if (res.status >= 200 && res.status < 300 && res.data) {
      return normalizeLpCreateOfframp(res.data, payload.requestId);
    }
    return null;
  } catch {
    return null;
  }
}
