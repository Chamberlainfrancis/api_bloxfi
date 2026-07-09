/**
 * Admin dashboard: proxy to the Liquidity Orchestrator's Business Provider
 * Customer admin API (set/list/remove a business's provider-side customer
 * identity — the id used at OwlPay/Yativo payout time).
 *
 * Both this route and the orchestrator's business-provider-customer admin
 * routes are deliberately unauthenticated (explicit decision — see
 * liquidity-orchestrator specs/033-business-provider-customer-mapping).
 * The orchestrator has no service-credential mechanism separate from human
 * admin-session login, so this proxy sends `set_by` on every write instead,
 * letting the acting bloxfi ops user's identifier reach the orchestrator's
 * audit trail even though there's no authenticated session on either leg.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { extractPalremitErrorMessage } from '@/services/palremitErrorMessage';

export interface ProviderCustomerRecord {
  tenant_id: string;
  business_reference: string;
  provider_name: string;
  channel_customer_id: string;
  set_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderCustomerListResult {
  business_reference: string;
  providers: Array<{ provider_name: string; channel_customer_id: string; updated_at: string }>;
}

export type ProviderCustomerResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

function adminPath(tenantId: string, businessReference: string, providerName?: string): string {
  const base = `/v1/admin/tenants/${encodeURIComponent(tenantId)}/businesses/${encodeURIComponent(businessReference)}/providers`;
  return providerName ? `${base}/${encodeURIComponent(providerName)}/customer` : base;
}

export async function putBusinessProviderCustomer(
  request: PalremitLiquidityRequestFn,
  params: {
    tenantId: string;
    businessReference: string;
    providerName: string;
    channelCustomerId: string;
    setBy: string;
  }
): Promise<ProviderCustomerResult<ProviderCustomerRecord>> {
  const res = await request<ProviderCustomerRecord>(
    adminPath(params.tenantId, params.businessReference, params.providerName),
    {
      method: 'PUT',
      body: { channel_customer_id: params.channelCustomerId, set_by: params.setBy },
    }
  );
  if (res.status !== 200) {
    return {
      ok: false,
      status: res.status,
      message: extractPalremitErrorMessage(res.data) ?? 'orchestrator rejected the request',
    };
  }
  return { ok: true, value: res.data as ProviderCustomerRecord };
}

export async function listBusinessProviderCustomers(
  request: PalremitLiquidityRequestFn,
  params: { tenantId: string; businessReference: string }
): Promise<ProviderCustomerResult<ProviderCustomerListResult>> {
  const res = await request<ProviderCustomerListResult>(
    adminPath(params.tenantId, params.businessReference),
    { method: 'GET' }
  );
  if (res.status !== 200) {
    return {
      ok: false,
      status: res.status,
      message: extractPalremitErrorMessage(res.data) ?? 'orchestrator rejected the request',
    };
  }
  return { ok: true, value: res.data as ProviderCustomerListResult };
}

export async function deleteBusinessProviderCustomer(
  request: PalremitLiquidityRequestFn,
  params: { tenantId: string; businessReference: string; providerName: string; setBy: string }
): Promise<ProviderCustomerResult<null>> {
  const query = `?set_by=${encodeURIComponent(params.setBy)}`;
  const res = await request<unknown>(
    `${adminPath(params.tenantId, params.businessReference, params.providerName)}${query}`,
    { method: 'DELETE' }
  );
  if (res.status !== 204) {
    return {
      ok: false,
      status: res.status,
      message: extractPalremitErrorMessage(res.data) ?? 'orchestrator rejected the request',
    };
  }
  return { ok: true, value: null };
}
