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
  status?: string;
  message?: string;
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

/** Read string-ish JSON fields (Palremit sometimes returns numbers for codes / account numbers). */
function readStrField(o: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string') {
      const t = v.trim();
      if (t) return t;
    }
    if (typeof v === 'number' && Number.isFinite(v)) {
      const s = String(v);
      if (s) return s;
    }
    if (typeof v === 'bigint') {
      const s = String(v);
      if (s) return s;
    }
  }
  return '';
}

/**
 * Normalize resolve payload: OpenAPI shows `{ data: { bank_code, ... } }`, but the orchestrator
 * may return a flat object at the root (like `POST /v1/provisioned-accounts`) or a LegacyEnvelope
 * `{ status, message, data }` where `data` holds the bank fields.
 */
function unwrapBankResolveRecord(body: unknown): Record<string, unknown> | null {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return null;
  const root = body as Record<string, unknown>;

  const hasResolveKeys = (o: Record<string, unknown>) =>
    readStrField(o, 'bank_code', 'bankCode') !== '' ||
    readStrField(o, 'account_number', 'accountNumber') !== '';

  if (hasResolveKeys(root)) return root;

  const nested = root.data;
  if (nested != null && typeof nested === 'object' && !Array.isArray(nested)) {
    const inner = nested as Record<string, unknown>;
    if (hasResolveKeys(inner)) return inner;

    const innerData = inner.data;
    if (innerData != null && typeof innerData === 'object' && !Array.isArray(innerData)) {
      const deep = innerData as Record<string, unknown>;
      if (hasResolveKeys(deep)) return deep;
    }
  }

  return null;
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
  const d = unwrapBankResolveRecord(res.data);
  if (!d) {
    throw new Error('PALREMIT_BANK_RESOLVE_INVALID_RESPONSE');
  }
  const bankCode = readStrField(d, 'bank_code', 'bankCode');
  const bankName = readStrField(d, 'bank_name', 'bankName');
  const accountNumber = readStrField(d, 'account_number', 'accountNumber');
  const accountName = readStrField(
    d,
    'account_name',
    'accountName',
    'account_holder_name',
    'accountHolderName',
    'beneficiary_name',
    'beneficiaryName'
  );
  if (!bankCode || !bankName || !accountNumber || !accountName) {
    throw new Error('PALREMIT_BANK_RESOLVE_INVALID_RESPONSE');
  }
  return { bankCode, bankName, accountNumber, accountName };
}
