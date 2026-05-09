/**
 * Palremit networks for a coin — prefer GET /v1/coins/get_coin_network_list; fallback GET /v1/coins/get_coin.
 * See [Liquidity Orchestrator — Coins](https://liquidity.palremit.com/docs#tag/coins).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { getPalremitCoin, getPalremitCoinNetworkList } from '@/core/integrations/palremitLiquidity';

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
  /** Chain id from Palremit (`network_code` or `network_name`, e.g. BSC, TRC20) — use in ramp `chain` fields. */
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

/**
 * Orchestrator rows use `network_code` and/or `network_name` as the chain id.
 * Live `get_coin_network_list` often omits `network_code` and puts BSC/TRC20/… in `network_name` only.
 */
function rowToNetworkOption(row: Record<string, unknown>): PalremitNetworkOption | null {
  let code = typeof row.network_code === 'string' ? row.network_code.trim() : '';
  if (!code) {
    code = typeof row.network_name === 'string' ? row.network_name.trim() : '';
  }
  if (!code) return null;
  let name: string | undefined;
  if (typeof row.network_display_name === 'string' && row.network_display_name.trim()) {
    name = row.network_display_name.trim();
  } else if (typeof row.network_name === 'string') {
    const nn = row.network_name.trim();
    if (nn && nn.toUpperCase() !== code.toUpperCase()) name = nn;
  }
  return {
    code,
    name,
    depositEnabled: rowDepositEnabled(row),
    withdrawEnabled: rowWithdrawEnabled(row),
  };
}

/** Parse `data` array from GET /v1/coins/get_coin_network_list. */
export function palremitNetworkOptionsFromCoinNetworkList(
  rows: unknown[] | null | undefined
): PalremitNetworkOption[] {
  if (!rows?.length) return [];
  const out: PalremitNetworkOption[] = [];
  for (const item of rows) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const opt = rowToNetworkOption(item as Record<string, unknown>);
    if (opt) out.push(opt);
  }
  return out;
}

/** Parse `data.network_list` from GET /v1/coins/get_coin (fallback). */
export function palremitNetworkOptionsFromCoinData(
  data: Record<string, unknown> | null | undefined
): PalremitNetworkOption[] {
  if (!data || !Array.isArray(data.network_list)) return [];
  const out: PalremitNetworkOption[] = [];
  for (const item of data.network_list) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) continue;
    const opt = rowToNetworkOption(item as Record<string, unknown>);
    if (opt) out.push(opt);
  }
  return out;
}

export async function fetchPalremitNetworksForCoin(
  request: PalremitLiquidityRequestFn,
  coinCode: string
): Promise<PalremitNetworkOption[] | null> {
  const listRows = await getPalremitCoinNetworkList(request, coinCode);
  if (listRows?.length) {
    return palremitNetworkOptionsFromCoinNetworkList(listRows);
  }
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
