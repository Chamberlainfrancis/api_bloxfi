/**
 * Palremit Liquidity Orchestrator — bank payout metadata ([Banks](https://liquidity.palremit.com/docs#tag/banks)).
 * `GET /v1/banks?asset=…`, `POST /v1/banks/resolve`. Resolve maps Palremit JSON (unwraps outer `data`) → BloxFi camelCase fields.
 *
 * **Fiat only:** bank resolve and lists apply to fiat payout assets (e.g. NGN), not crypto.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { logger } from '@/lib/logger';

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

function describeResolveBodyForLog(body: unknown): {
  bodyKind: string;
  topKeys: string[];
  dataKind: string;
  dataKeys: string[];
} {
  if (body == null) {
    return { bodyKind: String(body), topKeys: [], dataKind: 'n/a', dataKeys: [] };
  }
  if (typeof body === 'string') {
    return { bodyKind: 'string', topKeys: [], dataKind: 'n/a', dataKeys: [] };
  }
  if (Array.isArray(body)) {
    return { bodyKind: 'array', topKeys: [], dataKind: 'n/a', dataKeys: [] };
  }
  if (typeof body !== 'object') {
    return { bodyKind: typeof body, topKeys: [], dataKind: 'n/a', dataKeys: [] };
  }
  const o = body as Record<string, unknown>;
  const topKeys = Object.keys(o);
  const d = o.data;
  let dataKind = 'missing';
  let dataKeys: string[] = [];
  if (d != null) {
    if (Array.isArray(d)) dataKind = 'array';
    else if (typeof d === 'object') {
      dataKind = 'object';
      dataKeys = Object.keys(d as object);
    } else {
      dataKind = typeof d;
    }
  }
  return { bodyKind: 'object', topKeys, dataKind, dataKeys };
}

function logBankResolveParseFailure(
  reason: string,
  body: unknown,
  extra?: Record<string, boolean | string | number>
): void {
  logger.error(
    { reason, ...describeResolveBodyForLog(body), ...extra },
    'Palremit POST /v1/banks/resolve parse failure'
  );
}

function normalizePalremitJsonBody<T>(raw: T): unknown {
  if (typeof raw !== 'string') return raw;
  const t = raw.trim();
  if (!t || (!t.startsWith('{') && !t.startsWith('['))) return raw;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return raw;
  }
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

function resolveFieldScore(o: Record<string, unknown>): number {
  let s = 0;
  if (readStrField(o, 'bank_code', 'bankCode')) s++;
  if (readStrField(o, 'bank_name', 'bankName')) s++;
  if (readStrField(o, 'account_number', 'accountNumber')) s++;
  if (
    readStrField(
      o,
      'account_name',
      'accountName',
      'account_holder_name',
      'accountHolderName',
      'beneficiary_name',
      'beneficiaryName'
    )
  ) {
    s++;
  }
  return s;
}

function findBankResolveCore(body: unknown): Record<string, unknown> | null {
  type Match = { record: Record<string, unknown>; score: number; depth: number };
  const state: { best: Match | null } = { best: null };

  function walk(n: unknown, depth: number): void {
    if (n == null) return;
    if (Array.isArray(n)) {
      for (const item of n) walk(item, depth + 1);
      return;
    }
    if (typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const bc = readStrField(o, 'bank_code', 'bankCode');
    const an = readStrField(o, 'account_number', 'accountNumber');
    if (bc && an) {
      const score = resolveFieldScore(o);
      const cur = state.best;
      if (
        cur == null ||
        score > cur.score ||
        (score === cur.score && depth > cur.depth)
      ) {
        state.best = { record: o, score, depth };
      }
    }
    for (const v of Object.values(o)) {
      if (typeof v === 'string') {
        const t = v.trim();
        if (
          (t.startsWith('{') && t.endsWith('}')) ||
          (t.startsWith('[') && t.endsWith(']'))
        ) {
          try {
            walk(JSON.parse(t) as unknown, depth + 1);
          } catch {
            /* not JSON */
          }
        }
      }
      walk(v, depth + 1);
    }
  }

  walk(body, 0);
  return state.best == null ? null : state.best.record;
}

function readStrFieldDeep(node: unknown, ...keys: string[]): string {
  const seen = new Set<unknown>();
  function walk(n: unknown): string {
    if (n == null || typeof n !== 'object') return '';
    if (seen.has(n)) return '';
    seen.add(n);
    if (Array.isArray(n)) {
      for (const item of n) {
        const r = walk(item);
        if (r) return r;
      }
      return '';
    }
    const o = n as Record<string, unknown>;
    const direct = readStrField(o, ...keys);
    if (direct) return direct;
    for (const v of Object.values(o)) {
      if (typeof v === 'string') {
        const t = v.trim();
        if (
          (t.startsWith('{') && t.endsWith('}')) ||
          (t.startsWith('[') && t.endsWith(']'))
        ) {
          try {
            const r = walk(JSON.parse(t) as unknown);
            if (r) return r;
          } catch {
            /* not JSON */
          }
        }
      }
      const r = walk(v);
      if (r) return r;
    }
    return '';
  }
  return walk(node);
}

const ACCOUNT_NAME_KEYS = [
  'account_name',
  'accountName',
  'account_holder_name',
  'accountHolderName',
  'beneficiary_name',
  'beneficiaryName',
  'holder_name',
  'holderName',
  'customer_name',
  'customerName',
] as const;

/**
 * Palremit sometimes omits `account_number` (or `bank_code`) in `data` even when the request included them — echo request values.
 */
function tryResolveFromRecord(
  d: Record<string, unknown>,
  request: PalremitBankResolveInput
): PalremitBankResolveResult | null {
  const reqBankCode = request.bankCode.trim();
  const reqAccountNumber = request.accountNumber.trim();
  const bankCode = readStrField(d, 'bank_code', 'bankCode') || reqBankCode;
  const bankName = readStrField(d, 'bank_name', 'bankName');
  const accountNumber = readStrField(d, 'account_number', 'accountNumber') || reqAccountNumber;
  const accountName = readStrField(d, ...ACCOUNT_NAME_KEYS);
  if (bankCode && bankName && accountNumber && accountName) {
    return { bankCode, bankName, accountNumber, accountName };
  }
  return null;
}

/**
 * Map Palremit resolve JSON → BloxFi fields. Tries, in order: Palremit `data` object, stringified `data`,
 * flat root, `data` array first row, then tree walk (`findBankResolveCore`). Missing `bank_code` / `account_number`
 * in the response are filled from the request (Palremit may omit echoed digits).
 */
function extractBankResolveResult(
  raw: unknown,
  request: PalremitBankResolveInput
): PalremitBankResolveResult | null {
  const payload = normalizePalremitJsonBody(raw);
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const d0 = root.data;

  if (d0 != null && typeof d0 === 'object' && !Array.isArray(d0)) {
    const t = tryResolveFromRecord(d0 as Record<string, unknown>, request);
    if (t) return t;
  }

  if (typeof d0 === 'string') {
    const inner = normalizePalremitJsonBody(d0);
    if (inner != null && typeof inner === 'object' && !Array.isArray(inner)) {
      const t = tryResolveFromRecord(inner as Record<string, unknown>, request);
      if (t) return t;
    }
  }

  const flat = tryResolveFromRecord(root, request);
  if (flat) return flat;

  if (Array.isArray(d0) && d0.length > 0) {
    const first = d0[0];
    if (first != null && typeof first === 'object' && !Array.isArray(first)) {
      const t = tryResolveFromRecord(first as Record<string, unknown>, request);
      if (t) return t;
    }
  }

  const core = findBankResolveCore(payload);
  if (!core) return null;
  const bankCode = readStrField(core, 'bank_code', 'bankCode') || request.bankCode.trim();
  const accountNumber =
    readStrField(core, 'account_number', 'accountNumber') || request.accountNumber.trim();
  const bankName =
    readStrField(core, 'bank_name', 'bankName') || readStrFieldDeep(payload, 'bank_name', 'bankName');
  const accountName =
    readStrField(core, ...ACCOUNT_NAME_KEYS) ||
    readStrFieldDeep(payload, ...ACCOUNT_NAME_KEYS);
  if (!bankCode || !bankName || !accountNumber || !accountName) return null;
  return { bankCode, bankName, accountNumber, accountName };
}

/**
 * POST /v1/banks/resolve — snake_case request body; normalizes Palremit response → BloxFi camelCase.
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
  const result = extractBankResolveResult(res.data, input);
  if (result) return result;

  logBankResolveParseFailure('could not map Palremit resolve body to BloxFi fields', normalizePalremitJsonBody(res.data));
  throw new Error('PALREMIT_BANK_RESOLVE_INVALID_RESPONSE');
}
