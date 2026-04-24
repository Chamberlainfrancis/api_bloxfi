/**
 * Palremit networks for a coin — sourced only from GET /coins/get_coin (no static chain mapping).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { getPalremitCoin } from '@/core/integrations/palremitLiquidity';

export type PalremitRampChainField = 'source.chain' | 'destination.chain';

export class UnsupportedPalremitNetworkError extends Error {
  constructor(
    public readonly field: PalremitRampChainField,
    public readonly coinCode: string,
    public readonly requestedChain: string,
    public readonly validNetworkCodes: string[]
  ) {
    super(
      `${field} must match a Palremit network_code for ${coinCode}. Use GET /api/v1/networks?coin=${encodeURIComponent(coinCode)}.`
    );
    this.name = 'UnsupportedPalremitNetworkError';
  }
}

export interface PalremitNetworkOption {
  /** Palremit `network_code` (e.g. BSC, ETH, TRX) — use this in ramp `chain` fields. */
  code: string;
  name?: string;
  depositEnabled?: boolean;
  withdrawEnabled?: boolean;
}

function rowDepositEnabled(row: Record<string, unknown>): boolean | undefined {
  if (typeof row.deposit_enabled === 'boolean') return row.deposit_enabled;
  if (typeof row.depositEnabled === 'boolean') return row.depositEnabled;
  return undefined;
}

function rowWithdrawEnabled(row: Record<string, unknown>): boolean | undefined {
  if (typeof row.withdraw_enabled === 'boolean') return row.withdraw_enabled;
  if (typeof row.withdrawEnabled === 'boolean') return row.withdrawEnabled;
  return undefined;
}

/** Parse `data.network_list` from get_coin response. */
export function palremitNetworkOptionsFromCoinData(
  data: Record<string, unknown> | null | undefined
): PalremitNetworkOption[] {
  if (!data || !Array.isArray(data.network_list)) return [];
  const out: PalremitNetworkOption[] = [];
  for (const item of data.network_list) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const code = row.network_code;
    if (typeof code !== 'string' || !code.trim()) continue;
    const name = row.network_name;
    out.push({
      code: code.trim(),
      name: typeof name === 'string' ? name : undefined,
      depositEnabled: rowDepositEnabled(row),
      withdrawEnabled: rowWithdrawEnabled(row),
    });
  }
  return out;
}

export async function fetchPalremitNetworksForCoin(
  request: PalremitLiquidityRequestFn,
  coinCode: string
): Promise<PalremitNetworkOption[] | null> {
  const data = await getPalremitCoin(request, coinCode);
  if (!data) return null;
  return palremitNetworkOptionsFromCoinData(data as Record<string, unknown>);
}

export function resolvePalremitNetworkFromOptions(
  options: PalremitNetworkOption[],
  clientChain: string
): string | null {
  const want = clientChain.trim().toUpperCase();
  if (!want) return null;
  const hit = options.find((o) => o.code.toUpperCase() === want);
  return hit ? hit.code : null;
}

export async function resolvePalremitNetworkOrThrow(
  request: PalremitLiquidityRequestFn,
  coinCode: string,
  clientChain: string,
  field: PalremitRampChainField
): Promise<string> {
  const options = await fetchPalremitNetworksForCoin(request, coinCode);
  if (options == null) {
    throw new Error('PALREMIT_COIN_UNAVAILABLE');
  }
  const validCodes = options.map((o) => o.code);
  const resolved = resolvePalremitNetworkFromOptions(options, clientChain);
  if (!resolved) {
    throw new UnsupportedPalremitNetworkError(field, coinCode, clientChain, validCodes);
  }
  return resolved;
}
