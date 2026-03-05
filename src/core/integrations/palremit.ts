/**
 * Palremit LP integration. Maps Palremit APIs to our DTOs.
 * - Rates: currency-api.palremit.com (GET /pairs, POST /pairs/conversion)
 * - Liquidity: liquidity-api.palremit.com (ramp, deposits, withdrawals)
 * No Express/Prisma here. HTTP is injected so core does not import services.
 */

import type { GetOnrampRatesResponse } from '../../types/onramp';
import type { GetOfframpRatesResponse } from '../../types/offramp';

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
  BSC: 'BNB_CHAIN',
  SOL: 'SOLANA',
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

  try {
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
  } catch {
    return null;
  }
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

  try {
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
      rate: rateStr,
      inverseRate,
    };
  } catch {
    return null;
  }
}
