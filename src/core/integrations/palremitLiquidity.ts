/**
 * Palremit Liquidity API integration. Maps our flows to liquidity-api.palremit.com.
 * All functions accept an injected liquidityRequest (from services/palremitClient).
 * Used for: ramp (offramp), crypto deposits, fiat/crypto withdrawals.
 */

/** Liquidity API request function (injected; implemented by services). */
export interface PalremitLiquidityRequestFn {
  <T>(path: string, options?: { method?: string; body?: unknown }): Promise<{
    status: number;
    data: { status: string; message?: string; data: T | null };
  }>;
}

// --- Ramp (offramp) ---

export interface PalremitCreateCustomerProfileBody {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  country: string;
}

export interface PalremitCustomerProfile {
  _id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  date_of_birth?: string;
  country: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PalremitCreateOfframpOrderBody {
  customer_id: string;
  source_amount: number;
  source_currency: string;
  source_network: string;
  destination_type: 'bank_account' | 'crypto_address';
  destination_currency: string;
  destination_information: Record<string, string>;
  app_fee?: { value: number; unit: string };
}

export interface PalremitOfframpOrder {
  reference: string;
  type: string;
  source_amount: number;
  source_currency: string;
  source_network?: string;
  destination_type?: string;
  destination_currency?: string;
  destination_amount?: number;
  destination_name?: string;
  destination_code?: string;
  destination_account?: string;
  destination_account_name?: string;
  payment_information?: {
    amount: number;
    currency: string;
    address: string;
    network_name?: string;
    network_code?: string;
    token?: string;
  };
  app_fee?: { unit: string; value: number };
  status: string;
  createdAt?: string;
}

export async function createPalremitCustomerProfile(
  request: PalremitLiquidityRequestFn,
  body: PalremitCreateCustomerProfileBody
): Promise<PalremitCustomerProfile | null> {
  const res = await request<PalremitCustomerProfile>('/ramp/create_customer_profile', {
    method: 'POST',
    body,
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

export async function createPalremitOfframpOrder(
  request: PalremitLiquidityRequestFn,
  body: PalremitCreateOfframpOrderBody
): Promise<PalremitOfframpOrder | null> {
  const res = await request<PalremitOfframpOrder>('/ramp/create_offramp_order', {
    method: 'POST',
    body,
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

export async function getPalremitRampOrder(
  request: PalremitLiquidityRequestFn,
  reference: string
): Promise<PalremitOfframpOrder | null> {
  const res = await request<PalremitOfframpOrder>(`/ramp/get_order?reference=${encodeURIComponent(reference)}`, {
    method: 'GET',
  });
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

export async function listPalremitRampOrders(
  request: PalremitLiquidityRequestFn,
  params?: { page?: number; limit?: number; type?: string; status?: string }
): Promise<{ count: number; result: PalremitOfframpOrder[] } | null> {
  const q = new URLSearchParams();
  if (params?.page != null) q.set('page', String(params.page));
  if (params?.limit != null) q.set('limit', String(params.limit));
  if (params?.type) q.set('type', params.type);
  if (params?.status) q.set('status', params.status);
  const res = await request<{ count: number; result: PalremitOfframpOrder[] }>(
    `/ramp/get_orders?${q.toString()}`,
    { method: 'GET' }
  );
  if (res.status !== 200 || res.data.status !== 'success' || !res.data.data) return null;
  return res.data.data;
}

// --- Crypto deposits ---

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
