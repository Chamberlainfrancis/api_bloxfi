/**
 * Palremit Liquidity Orchestrator — bank payout metadata ([Banks](https://liquidity.palremit.com/docs#tag/banks)).
 * `GET /v1/banks?asset=…`, `POST /v1/banks/resolve`. Response envelope: `{ data: … }` (not LegacyEnvelope).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

export interface PalremitBankRow {
  code: string;
  name: string;
  country: string;
  status: string;
}

export interface PalremitBankResolveInput {
  asset: string;
  bankCode: string;
  accountNumber: string;
}

export interface PalremitBankResolveResult {
  bankCode: string;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

interface PalremitDataEnvelope<T> {
  data?: T;
}

function parseBankRow(raw: unknown): PalremitBankRow | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const code = typeof o.code === 'string' ? o.code.trim() : '';
  const name = typeof o.name === 'string' ? o.name.trim() : '';
  const country = typeof o.country === 'string' ? o.country.trim() : '';
  const status = typeof o.status === 'string' ? o.status.trim() : '';
  if (!code || !name || !country || !status) return null;
  return { code, name, country, status };
}

/**
 * GET /v1/banks?asset=NGN — active banks for the payout asset.
 */
export async function listPalremitBanksForAsset(
  request: PalremitLiquidityRequestFn,
  asset: string
): Promise<PalremitBankRow[]> {
  const a = asset.trim().toUpperCase();
  const q = new URLSearchParams();
  q.set('asset', a);
  const res = await request<PalremitDataEnvelope<unknown>>(`/v1/banks?${q.toString()}`, {
    method: 'GET',
  });
  const rows = res.data?.data;
  if (!Array.isArray(rows)) {
    throw new Error('PALREMIT_BANKS_INVALID_RESPONSE');
  }
  return rows.map(parseBankRow).filter((x): x is PalremitBankRow => x != null);
}

function readString(o: Record<string, unknown>, snake: string, camel: string): string {
  const v = o[snake] ?? o[camel];
  return typeof v === 'string' ? v.trim() : '';
}

/**
 * POST /v1/banks/resolve — account name lookup for bank payouts.
 */
export async function resolvePalremitBankAccount(
  request: PalremitLiquidityRequestFn,
  input: PalremitBankResolveInput
): Promise<PalremitBankResolveResult> {
  const body = {
    asset: input.asset.trim().toUpperCase(),
    destination_type: 'bank_account' as const,
    bank_code: input.bankCode.trim(),
    account_number: input.accountNumber.trim(),
  };
  const res = await request<PalremitDataEnvelope<Record<string, unknown>>>('/v1/banks/resolve', {
    method: 'POST',
    body,
  });
  const d = res.data?.data;
  if (d == null || typeof d !== 'object' || Array.isArray(d)) {
    throw new Error('PALREMIT_BANK_RESOLVE_INVALID_RESPONSE');
  }
  const bankCode = readString(d, 'bank_code', 'bankCode');
  const bankName = readString(d, 'bank_name', 'bankName');
  const accountNumber = readString(d, 'account_number', 'accountNumber');
  const accountName = readString(d, 'account_name', 'accountName');
  if (!bankCode || !bankName || !accountNumber || !accountName) {
    throw new Error('PALREMIT_BANK_RESOLVE_INVALID_RESPONSE');
  }
  return { bankCode, bankName, accountNumber, accountName };
}
