/**
 * Admin dashboard: proxy to the Liquidity Orchestrator's Business Provider
 * Customer API (set/list/remove a business's provider-side customer
 * identity — the id used at OwlPay/Yativo payout time).
 *
 * Authenticated with the tenant Bearer token (PALREMIT_LIQUIDITY_SECRET).
 * tenant_id is resolved from the token on the orchestrator side and stored
 * on each mapping row.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { extractPalremitErrorMessage } from '@/services/palremitErrorMessage';

/** Reserved orchestrator business_reference for platform house customer ids. */
export const HOUSE_BUSINESS_REFERENCE = '__house__';

/**
 * Dashboard assumes the orchestrator has ALLOW_HOUSE_CUSTOMER_FALLBACK=true.
 * Not an env var — bloxfi is single-tenant and always presents house mode.
 * Flip to false only if the orchestrator flag is turned off.
 */
export const HOUSE_CUSTOMER_FALLBACK_ENABLED = true;

export interface ProviderCustomerRecord {
  tenant_id: string;
  business_reference: string;
  provider_name: string;
  channel_customer_id: string;
  business_email: string | null;
  set_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProviderCustomerListResult {
  business_reference: string;
  business_email?: string | null;
  providers: Array<{
    provider_name: string;
    channel_customer_id: string;
    business_email?: string | null;
    updated_at: string;
  }>;
}

export type ProviderCustomerResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

// 037-swipelux-onramp: swipelux added — it's an onramp (deposit) provider
// resolved via this same business_provider_customers mapping, not a
// payout provider like owlpay/yativo, but the mechanism (and this
// dashboard's status display) is identical.
export const DASHBOARD_PROVIDER_NAMES = ['owlpay', 'yativo', 'swipelux'] as const;
export type DashboardProviderName = (typeof DASHBOARD_PROVIDER_NAMES)[number];
/** custom = own mapping; house = falling back to __house__; inactive = neither */
export type DashboardProviderStatus = 'custom' | 'house' | 'inactive';

export type DashboardProviderStatusMap = Record<DashboardProviderName, DashboardProviderStatus>;

export function emptyDashboardProviderStatus(): DashboardProviderStatusMap {
  return { owlpay: 'inactive', yativo: 'inactive', swipelux: 'inactive' };
}

function isDashboardProviderName(name: string): name is DashboardProviderName {
  return (DASHBOARD_PROVIDER_NAMES as readonly string[]).includes(name);
}

/**
 * Pure status computation — unit-tested without HTTP.
 * Business mapping wins; house only when fallback is enabled and house has an id.
 */
export function computeDashboardProviderStatus(params: {
  businessProviders: Array<{ provider_name: string; channel_customer_id?: string | null }>;
  houseProviders: Array<{ provider_name: string; channel_customer_id?: string | null }>;
  allowHouseFallback: boolean;
}): DashboardProviderStatusMap {
  const status = emptyDashboardProviderStatus();
  const businessIds = new Map<string, string>();
  for (const row of params.businessProviders) {
    if (isDashboardProviderName(row.provider_name) && row.channel_customer_id?.trim()) {
      businessIds.set(row.provider_name, row.channel_customer_id.trim());
    }
  }
  const houseIds = new Map<string, string>();
  if (params.allowHouseFallback) {
    for (const row of params.houseProviders) {
      if (isDashboardProviderName(row.provider_name) && row.channel_customer_id?.trim()) {
        houseIds.set(row.provider_name, row.channel_customer_id.trim());
      }
    }
  }
  for (const name of DASHBOARD_PROVIDER_NAMES) {
    if (businessIds.has(name)) status[name] = 'custom';
    else if (houseIds.has(name)) status[name] = 'house';
    else status[name] = 'inactive';
  }
  return status;
}

export async function resolveDashboardProviderStatus(
  request: PalremitLiquidityRequestFn,
  params: {
    tenantId: string;
    businessReference: string;
    allowHouseFallback: boolean;
    houseProviders?: ProviderCustomerListResult['providers'];
  }
): Promise<DashboardProviderStatusMap> {
  try {
    const result = await listBusinessProviderCustomers(request, params);
    if (!result.ok) return emptyDashboardProviderStatus();

    let houseProviders = params.houseProviders;
    if (houseProviders === undefined && params.allowHouseFallback) {
      const house = await listBusinessProviderCustomers(request, {
        tenantId: params.tenantId,
        businessReference: HOUSE_BUSINESS_REFERENCE,
      });
      houseProviders = house.ok ? house.value.providers : [];
    }

    return computeDashboardProviderStatus({
      businessProviders: result.value.providers,
      houseProviders: houseProviders ?? [],
      allowHouseFallback: params.allowHouseFallback,
    });
  } catch {
    return emptyDashboardProviderStatus();
  }
}

function businessProviderPath(businessReference: string, providerName?: string): string {
  const base = `/v1/businesses/${encodeURIComponent(businessReference)}/providers`;
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
    businessEmail?: string | null;
  }
): Promise<ProviderCustomerResult<ProviderCustomerRecord>> {
  const body: Record<string, unknown> = {
    channel_customer_id: params.channelCustomerId,
    set_by: params.setBy,
  };
  if (params.businessEmail !== undefined) {
    body.business_email = params.businessEmail;
  }
  const res = await request<ProviderCustomerRecord>(
    businessProviderPath(params.businessReference, params.providerName),
    {
      method: 'PUT',
      body,
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
    businessProviderPath(params.businessReference),
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
    `${businessProviderPath(params.businessReference, params.providerName)}${query}`,
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
