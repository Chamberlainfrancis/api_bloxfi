import { logger } from '@/lib/logger';
import {
  buildPalremitFailureLogMsg,
  extractPalremitErrorMessage,
  getPalremitLogCategory,
} from '@/services/palremitErrorMessage';

/**
 * Palremit Liquidity Orchestrator — /v1/provisioned-accounts, /v1/deposits, /v1/withdrawals.
 * Coin catalogue — `/v1/coins/*` ([docs — Coins](https://liquidity.palremit.com/docs#tag/coins)):
 * `get_all_coins`, `get_coin`, `get_coin_network_list`, etc. All use **LegacyEnvelope** `{ status, message, data }`.
 * Those routes are **security: []** in OpenAPI; we still send our Bearer secret when calling the orchestrator.
 */

/** Request function: HTTP status + parsed JSON body */
export interface PalremitLiquidityRequestFn {
  <T = unknown>(
    path: string,
    options?: {
      method?: string;
      body?: unknown;
      headers?: Record<string, string>;
    }
  ): Promise<{ status: number; data: T }>;
}

// --- Coin metadata (unchanged contract: legacy envelope) ---

export interface PalremitCoinNetworkListRow {
  network_code: string;
  network_name?: string;
  network_coin?: string;
  deposit_enabled?: boolean;
  withdraw_enabled?: boolean;
  depositEnabled?: boolean;
  withdrawEnabled?: boolean;
  [key: string]: unknown;
}

export interface PalremitGetCoinData {
  coin_code?: string;
  coin_name?: string;
  network_list?: PalremitCoinNetworkListRow[];
  [key: string]: unknown;
}

/**
 * GET /v1/coins/get_coin?coin_code=USDT
 */
export async function getPalremitCoin(
  request: PalremitLiquidityRequestFn,
  coinCode: string
): Promise<PalremitGetCoinData | null> {
  const code = coinCode?.trim().toUpperCase();
  if (!code) return null;
  const q = new URLSearchParams();
  q.set('coin_code', code);
  const res = await request<PalremitEnvelopeBody<PalremitGetCoinData>>(
    `/v1/coins/get_coin?${q.toString()}`,
    { method: 'GET' }
  );
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  const data = res.data.data;
  return data != null && typeof data === 'object' && !Array.isArray(data)
    ? (data as PalremitGetCoinData)
    : null;
}

/**
 * GET /v1/coins/get_all_coins — `data` is an array of coin summary objects.
 */
export async function listPalremitAllCoins(
  request: PalremitLiquidityRequestFn
): Promise<unknown[] | null> {
  const res = await request<PalremitEnvelopeBody<unknown>>('/v1/coins/get_all_coins', { method: 'GET' });
  if (res.status !== 200 || res.data.status !== 'success' || res.data.data == null) return null;
  const d = res.data.data;
  return Array.isArray(d) ? d : null;
}

/**
 * GET /v1/coins/get_coin_network_list?coin_code=USDT — `data` is an array of networks with `network_code`.
 */
export async function getPalremitCoinNetworkList(
  request: PalremitLiquidityRequestFn,
  coinCode: string
): Promise<unknown[] | null> {
  const code = coinCode?.trim().toUpperCase();
  if (!code) return null;
  const q = new URLSearchParams();
  q.set('coin_code', code);
  const res = await request<PalremitEnvelopeBody<unknown>>(
    `/v1/coins/get_coin_network_list?${q.toString()}`,
    { method: 'GET' }
  );
  if (res.status !== 200 || res.data.status !== 'success' || res.data.data == null) return null;
  const d = res.data.data;
  return Array.isArray(d) ? d : null;
}

interface PalremitEnvelopeBody<T> {
  status: string;
  message?: string;
  data?: T | null;
}

// --- Provisioned accounts (deposits intake) ---

export type PalremitDepositProvisionMode = 'FIAT_DEPOSIT_NO_KYC' | 'FIAT_DEPOSIT_KYC' | 'CRYPTO_DEPOSIT';

export interface PalremitProvisionedAccount {
  id: string;
  client_reference: string;
  asset: string;
  mode: string;
  network: string | null;
  state: string;
  deposit_instructions?: PalremitDepositInstructions | null;
  failure_reason?: unknown;
  created_at?: string;
  last_state_transition_at?: string;
  [key: string]: unknown;
}

export type PalremitDepositInstructions =
  | {
      kind: 'fiat_account';
      account_number: string;
      bank_code: string;
      bank_name: string;
      account_holder_name: string;
      [key: string]: unknown;
    }
  | {
      kind: 'crypto_address';
      address: string;
      network: string;
      memo: string | null;
      [key: string]: unknown;
    };

export async function provisionPalremitDepositAccount(
  request: PalremitLiquidityRequestFn,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<{ account: PalremitProvisionedAccount; httpStatus: number } | null> {
  const res = await request<PalremitProvisionedAccount>('/v1/provisioned-accounts', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (![200, 201, 202].includes(res.status)) return null;
  const acc = res.data as PalremitProvisionedAccount;
  if (!acc?.id) return null;
  return { account: acc, httpStatus: res.status };
}

export async function getPalremitProvisionedAccount(
  request: PalremitLiquidityRequestFn,
  id: string
): Promise<PalremitProvisionedAccount | null> {
  const trimmed = id?.trim();
  if (!trimmed) return null;
  const res = await request<PalremitProvisionedAccount>(`/v1/provisioned-accounts/${trimmed}`, {
    method: 'GET',
  });
  if (res.status !== 200) return null;
  return res.data as PalremitProvisionedAccount;
}

export async function listPalremitProvisionedAccounts(
  request: PalremitLiquidityRequestFn,
  query: Record<string, string | undefined>
): Promise<PalremitProvisionedAccount[] | null> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') q.set(k, v);
  }
  const qs = q.toString();
  const path = qs ? `/v1/provisioned-accounts?${qs}` : '/v1/provisioned-accounts';
  const res = await request<{ items: PalremitProvisionedAccount[] }>(path, { method: 'GET' });
  if (res.status !== 200) return null;
  const items = (res.data as { items?: PalremitProvisionedAccount[] })?.items;
  return Array.isArray(items) ? items : null;
}

// --- Deposits (read lifecycle) ---

export async function getPalremitDepositById(
  request: PalremitLiquidityRequestFn,
  depositId: string
): Promise<Record<string, unknown> | null> {
  const id = depositId?.trim();
  if (!id) return null;
  const res = await request<Record<string, unknown>>(`/v1/deposits/${id}`, { method: 'GET' });
  if (res.status !== 200) return null;
  return res.data as Record<string, unknown>;
}

// --- Withdrawals ---

export interface PalremitWithdrawalCreateResult {
  id: string;
  client_reference: string;
  state: string;
  raw: unknown;
}

function parsePalremitWithdrawalBody(raw: unknown): PalremitWithdrawalCreateResult | null {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const wrap = raw as { data?: unknown };
  const candidate =
    wrap.data != null && typeof wrap.data === 'object' && !Array.isArray(wrap.data)
      ? (wrap.data as Record<string, unknown>)
      : (raw as Record<string, unknown>);
  const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
  const clientRef =
    typeof candidate.client_reference === 'string' ? candidate.client_reference.trim() : '';
  const state = typeof candidate.state === 'string' ? candidate.state.trim() : '';
  if (!id || !clientRef) return null;
  return { id, client_reference: clientRef, state, raw };
}

/** GET /v1/withdrawals/by-client-ref/:client_reference */
export async function getPalremitWithdrawalByClientReference(
  request: PalremitLiquidityRequestFn,
  clientReference: string
): Promise<PalremitWithdrawalCreateResult | null> {
  const ref = clientReference?.trim();
  if (!ref) return null;
  const res = await request<Record<string, unknown>>(
    `/v1/withdrawals/by-client-ref/${encodeURIComponent(ref)}`,
    { method: 'GET' }
  );
  if (res.status !== 200) return null;
  return parsePalremitWithdrawalBody(res.data);
}

export async function createPalremitWithdrawal(
  request: PalremitLiquidityRequestFn,
  body: Record<string, unknown>,
  idempotencyKey: string
): Promise<PalremitWithdrawalCreateResult | null> {
  const logCategory = getPalremitLogCategory({
    api: 'liquidity',
    method: 'POST',
    path: '/v1/withdrawals',
    idempotencyKey,
  });
  const res = await request<Record<string, unknown>>('/v1/withdrawals', {
    method: 'POST',
    body,
    headers: { 'Idempotency-Key': idempotencyKey },
  });
  if (res.status !== 202) {
    const palremitMessage = extractPalremitErrorMessage(res.data);
    logger.error(
      {
        logCategory,
        path: '/v1/withdrawals',
        operation: 'POST /v1/withdrawals',
        httpStatus: res.status,
        expectedHttpStatus: 202,
        palremitMessage,
      },
      buildPalremitFailureLogMsg({
        category: logCategory,
        responseData: res.data,
        method: 'POST',
        path: '/v1/withdrawals',
        httpStatus: res.status,
      })
    );
    return null;
  }
  return parsePalremitWithdrawalBody(res.data);
}
