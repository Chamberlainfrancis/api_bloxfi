/**
 * Palremit Liquidity API integration. Partner ramps use §5 (deposits) + §6 (withdrawals) only —
 * docs/palremit_integration_guide.md (§4 ramp API is not used).
 */

/** Liquidity API request function (injected; implemented by services). */
export interface PalremitLiquidityRequestFn {
  <T>(path: string, options?: { method?: string; body?: unknown }): Promise<{
    status: number;
    data: { status: string; message?: string; data: T | null };
  }>;
}

// --- Crypto deposits (§5) ---

export interface PalremitCreateCryptoAddressNewUserBody {
  first_name: string;
  last_name: string;
  currency: string;
  network?: string;
}

export interface PalremitCreateCryptoAddressBody {
  channel_user_id: string;
  currency: string;
  network?: string;
}

export interface PalremitCryptoAddress {
  currency: string;
  address: string;
  network: string;
  channel?: string;
  channel_user_id?: string;
  channel_address_id?: string;
  status?: string;
  createdAt?: string;
}

export async function createPalremitCryptoAddressNewUser(
  request: PalremitLiquidityRequestFn,
  body: PalremitCreateCryptoAddressNewUserBody
): Promise<PalremitCryptoAddress | null> {
  const res = await request<PalremitCryptoAddress>('/deposits/create_crypto_address_new_user', {
    method: 'POST',
    body,
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

export async function createPalremitCryptoAddress(
  request: PalremitLiquidityRequestFn,
  body: PalremitCreateCryptoAddressBody
): Promise<PalremitCryptoAddress | null> {
  const res = await request<PalremitCryptoAddress>('/deposits/create_crypto_address', {
    method: 'POST',
    body,
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

export interface PalremitCryptoDeposit {
  tx_id?: string;
  source_address?: string;
  destination_address?: string;
  currency: string;
  amount: number;
  network: string;
  confirmations?: number;
  status: string;
  createdAt?: string;
}

export async function listPalremitCryptoDeposits(
  request: PalremitLiquidityRequestFn,
  params?: { currency?: string; network?: string; status?: string; limit?: number; page?: number }
): Promise<PalremitCryptoDeposit[] | null> {
  const q = new URLSearchParams();
  if (params?.currency) q.set('currency', params.currency);
  if (params?.network) q.set('network', params.network);
  if (params?.status) q.set('status', params.status);
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.page != null) q.set('page', String(params.page));
  const res = await request<PalremitCryptoDeposit[]>(`/deposits/get_crypto_deposits?${q.toString()}`, {
    method: 'GET',
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

/** LP fiat deposit instructions (user wires fiat before crypto payout). */
export interface PalremitCreateFiatDepositBody {
  first_name: string;
  last_name: string;
  email: string;
  currency: string;
  amount: number;
}

export async function createPalremitFiatDeposit(
  request: PalremitLiquidityRequestFn,
  body: PalremitCreateFiatDepositBody
): Promise<Record<string, unknown> | null> {
  const res = await request<Record<string, unknown>>('/deposits/create_fiat_deposit', {
    method: 'POST',
    body,
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  const data = res.data.data;
  return data != null && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

// --- Fiat withdrawal ---

export interface PalremitCreateFiatWithdrawalBody {
  reference: string;
  destination_amount: number;
  destination_currency: string;
  destination_type: string;
  destination_information: Record<string, string>;
  app_fee?: number;
  app_fee_currency?: string;
}

export async function createPalremitFiatWithdrawal(
  request: PalremitLiquidityRequestFn,
  body: PalremitCreateFiatWithdrawalBody
): Promise<{ reference: string; status: string; createdAt?: string } | null> {
  const res = await request('/withdrawals/create_withdrawal', { method: 'POST', body });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data as { reference: string; status: string; createdAt?: string };
}

export async function confirmPalremitFiatWithdrawal(
  request: PalremitLiquidityRequestFn,
  reference: string
): Promise<{ reference: string; status: string } | null> {
  const res = await request('/withdrawals/confirm_withdrawal', {
    method: 'POST',
    body: { reference },
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data as { reference: string; status: string };
}

// --- Crypto withdrawal ---

export interface PalremitPrepareCryptoWithdrawalBody {
  source_amount: number;
  source_currency: string;
  destination_currency: string;
  destination_network: string;
  destination_address: string;
  destination_token?: string;
  app_fee?: number;
  app_fee_currency?: string;
}

export async function preparePalremitCryptoWithdrawal(
  request: PalremitLiquidityRequestFn,
  body: PalremitPrepareCryptoWithdrawalBody
): Promise<{ reference: string; status: string; createdAt?: string } | null> {
  const res = await request('/withdrawals/prepare_crypto_withdrawal', { method: 'POST', body });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data as { reference: string; status: string; createdAt?: string };
}

export async function confirmPalremitCryptoWithdrawal(
  request: PalremitLiquidityRequestFn,
  reference: string
): Promise<{ reference: string; status: string } | null> {
  const res = await request('/withdrawals/withdraw_to_crypto_address', {
    method: 'POST',
    body: { reference },
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data as { reference: string; status: string };
}
