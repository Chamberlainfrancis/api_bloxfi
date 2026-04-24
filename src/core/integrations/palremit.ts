/**
 * Palremit LP integration. Maps Palremit APIs to our DTOs.
 * - Rates: currency-api.palremit.com (GET /pairs, POST /pairs/conversion)
 * - Liquidity: liquidity-api.palremit.com (ramp, deposits, withdrawals)
 * No Express/Prisma here. HTTP is injected so core does not import services.
 */

import type { GetOnrampRatesResponse } from '@/types/onramp';
import type { GetOfframpRatesResponse } from '@/types/offramp';

/** Currency API conversion response data */
interface PalremitConversionData {
  rate?: string | number;
  conversion?: number;
  rateCurrency?: string;
  perCurrency?: string;
  symbol?: string;
  side?: string;
}

export interface PalremitCurrencyRequestFn {
  <T>(path: string, options?: { method?: string; body?: unknown }): Promise<{
    status: number;
    data: { status: string; data: T | null };
  }>;
}

/**
 * Map Palremit network code to our chain (BloxFi spec).
 * Palremit: TRX, ETH, BSC, SOL, MATIC, etc.
 */
export const PALREMIT_NETWORK_TO_CHAIN: Record<string, string> = {
  TRX: 'TRON',
  ETH: 'ETHEREUM',
  /** BNB Smart Chain — LP `prepare_crypto_withdrawal` accepts `BNB` (and lists `BSC`; we use `BNB` for reliability). */
  BNB: 'BNB_CHAIN',
  BSC: 'BNB_CHAIN',
  SOL: 'SOLANA',
  SOLANA: 'SOLANA',
  MATIC: 'POLYGON',
  OPTIMISM: 'OPTIMISM',
  CELO: 'CELO',
  XLM: 'STELLAR',
  BTC: 'BITCOIN',
  TON: 'TON',
};

export const CHAIN_TO_PALREMIT_NETWORK: Record<string, string> = Object.fromEntries(
  Object.entries(PALREMIT_NETWORK_TO_CHAIN).map(([k, v]) => [v, k])
);

// Common chain aliases seen in client payloads.
CHAIN_TO_PALREMIT_NETWORK.BINANCE_SMART_CHAIN = 'BNB';
CHAIN_TO_PALREMIT_NETWORK.BNB_CHAIN = 'BNB';
CHAIN_TO_PALREMIT_NETWORK.BSC = 'BNB';
CHAIN_TO_PALREMIT_NETWORK.TRON = 'TRX';
CHAIN_TO_PALREMIT_NETWORK.SOLANA = 'SOLANA';
CHAIN_TO_PALREMIT_NETWORK.BITCOIN = 'BTC';
CHAIN_TO_PALREMIT_NETWORK.ETHEREUM = 'ETH';
CHAIN_TO_PALREMIT_NETWORK.POLYGON = 'MATIC';
CHAIN_TO_PALREMIT_NETWORK.STELLAR = 'XLM';

/**
 * Fetch onramp rate from Palremit Currency API.
 * Uses POST /pairs/conversion with amount=1 to get rate for fromCurrency → toCurrency.
 * currencyRequest is injected (implemented by services/palremitClient).
 * Returns null if pair not supported or API error.
 */
export async function getPalremitOnrampRates(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string
): Promise<GetOnrampRatesResponse | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  if (!from || !to) return null;

  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: { from, to, amount: 1 },
  });
  if (res.status !== 200 || !res.data?.data) return null;
  if (res.data.status !== 'success') return null;

  const d = res.data.data;
  const rate =
    typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rate == null || rate === '') return null;

  return {
    fromCurrency: from.toLowerCase(),
    toCurrency: to.toLowerCase(),
    conversionRate: rate,
  };
}

export interface GetOnrampQuoteResponse extends GetOnrampRatesResponse {
  /** Amount of `toCurrency` returned by Palremit for the requested `amount`. */
  conversion: number;
}

/**
 * Fetch an onramp quote from Palremit Currency API for an explicit amount.
 * Prefer this for onramp creation to avoid applying `rate` manually.
 */
export async function getPalremitOnrampQuote(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string,
  amount: number,
  b2b?: boolean
): Promise<GetOnrampQuoteResponse | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  const amt = typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : 1;
  if (!from || !to) return null;

  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: { from, to, amount: amt, b2b: b2b === true ? true : undefined },
  });
  if (res.status !== 200 || !res.data?.data) return null;
  if (res.data.status !== 'success') return null;

  const d = res.data.data;
  const rate =
    typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rate == null || rate === '') return null;
  if (typeof d.conversion !== 'number' || !Number.isFinite(d.conversion)) return null;

  return {
    fromCurrency: from.toLowerCase(),
    toCurrency: to.toLowerCase(),
    conversionRate: rate,
    conversion: d.conversion,
  };
}

/**
 * Fetch offramp rate (crypto → fiat) from Palremit Currency API.
 * Uses POST /pairs/conversion with amount=1; returns rate and inverseRate.
 */
export async function getPalremitOfframpRates(
  currencyRequest: PalremitCurrencyRequestFn,
  fromCurrency: string,
  toCurrency: string,
  fromChain?: string
): Promise<GetOfframpRatesResponse | null> {
  const from = (fromCurrency ?? '').trim().toUpperCase();
  const to = (toCurrency ?? '').trim().toUpperCase();
  if (!from || !to) return null;

  const res = await currencyRequest<PalremitConversionData>('/pairs/conversion', {
    method: 'POST',
    body: { from, to, amount: 1 },
  });
  if (res.status !== 200 || !res.data?.data) return null;
  if (res.data.status !== 'success') return null;

  const d = res.data.data;
  const rateStr =
    typeof d.rate === 'string' ? d.rate : d.rate != null ? String(d.rate) : null;
  if (rateStr == null || rateStr === '') return null;
  const rateNum = parseFloat(rateStr);
  const inverseRate = rateNum > 0 ? String(1 / rateNum) : '0';

  return {
    fromCurrency: from.toLowerCase(),
    toCurrency: to.toLowerCase(),
    fromChain: fromChain?.trim() || undefined,
    conversionRate: rateStr,
    inverseRate,
    rateValidUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    minimumAmount: '10.00',
    maximumAmount: '50000.00',
    estimatedProcessingTime: '1-3 business days',
    availableRails: [],
  };
}
