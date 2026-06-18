/**
 * Palremit Liquidity — GET /v1/withdrawals/corridors (list, filter, fiat detail).
 * @see https://liquidity.palremit.com/docs#tag/withdrawals/GET/v1/withdrawals/corridors
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

export interface PalremitCorridorAmount {
  min: number | null;
  max: number | null;
  currency: string;
}

export interface PalremitFiatCorridorRow {
  target_fiat: string;
  country: string;
  destination_type: string;
  beneficiary_type: string;
  /** Human-readable rail label from Palremit/OwlPay (e.g. "Fedwire",
   *  "Bank Transfer", "Nequi"); null when unknown. */
  payout_rail_label?: string | null;
  amount: PalremitCorridorAmount;
}

export interface PalremitCorridorListResponse {
  corridors: PalremitFiatCorridorRow[];
  truncated?: boolean;
}

export interface PalremitDestinationFieldDescriptor {
  path: string;
  type: string;
  required: boolean;
  label: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  enum?: Array<{ value: string | number | boolean; label?: string }>;
  conditional_required?: Array<{
    when: { path: string; equals?: string | number | boolean; note?: string };
    required: true;
    label?: string;
    enum?: Array<{ value: string | number | boolean; label?: string }>;
  }>;
}

export interface PalremitCorridorDetailResponse {
  corridor: {
    target_fiat: string;
    country: string;
    destination_type: string;
    beneficiary_type: string;
    payout_rail_label?: string | null;
  };
  destination_fields: PalremitDestinationFieldDescriptor[];
  destination_template: Record<string, unknown>;
  amount: PalremitCorridorAmount;
}

export interface PalremitCorridorQuery {
  asset?: string;
  targetFiat?: string;
  country?: string;
  destinationType?: string;
  beneficiaryType?: string;
  network?: string;
}

function buildCorridorQueryString(query: PalremitCorridorQuery): string {
  const q = new URLSearchParams();
  const asset = query.asset?.trim() || query.targetFiat?.trim();
  if (asset) {
    q.set('asset', asset.toUpperCase());
  }
  if (query.country?.trim()) q.set('country', query.country.trim().toUpperCase());
  if (query.destinationType?.trim()) {
    q.set('destination_type', query.destinationType.trim().toLowerCase());
  }
  if (query.beneficiaryType?.trim()) {
    q.set('beneficiary_type', query.beneficiaryType.trim().toLowerCase());
  }
  if (query.network?.trim()) q.set('network', query.network.trim().toUpperCase());
  return q.toString();
}

function parseCorridorBody(body: unknown): unknown {
  if (body == null || typeof body !== 'object') return body;
  const o = body as Record<string, unknown>;
  if (o.data != null && typeof o.data === 'object') return o.data;
  return body;
}

export async function listPalremitWithdrawalCorridors(
  request: PalremitLiquidityRequestFn,
  query: PalremitCorridorQuery = {}
): Promise<PalremitCorridorListResponse> {
  const qs = buildCorridorQueryString(query);
  const path = qs ? `/v1/withdrawals/corridors?${qs}` : '/v1/withdrawals/corridors';
  const res = await request<unknown>(path, { method: 'GET' });
  if (res.status === 404) {
    throw new Error('PALREMIT_CORRIDOR_UNSUPPORTED');
  }
  if (res.status !== 200) {
    throw new Error('PALREMIT_CORRIDORS_UNAVAILABLE');
  }
  const parsed = parseCorridorBody(res.data) as PalremitCorridorListResponse;
  const corridors = Array.isArray(parsed?.corridors) ? parsed.corridors : [];
  return {
    corridors,
    truncated: parsed?.truncated === true,
  };
}

export async function getPalremitWithdrawalCorridorDetail(
  request: PalremitLiquidityRequestFn,
  tuple: {
    asset: string;
    country: string;
    destinationType: string;
    beneficiaryType: string;
  }
): Promise<PalremitCorridorDetailResponse> {
  const res = await request<unknown>(
    `/v1/withdrawals/corridors?${buildCorridorQueryString({
      asset: tuple.asset,
      country: tuple.country,
      destinationType: tuple.destinationType,
      beneficiaryType: tuple.beneficiaryType,
    })}`,
    { method: 'GET' }
  );
  if (res.status === 404) {
    throw new Error('PALREMIT_CORRIDOR_UNSUPPORTED');
  }
  if (res.status !== 200) {
    throw new Error('PALREMIT_CORRIDORS_UNAVAILABLE');
  }
  const parsed = parseCorridorBody(res.data) as PalremitCorridorDetailResponse;
  if (!parsed?.corridor || !Array.isArray(parsed.destination_fields)) {
    throw new Error('PALREMIT_CORRIDOR_INVALID_RESPONSE');
  }
  return parsed;
}

/** BloxFi camelCase corridor row for API responses. */
export function mapPalremitCorridorRowToApi(row: PalremitFiatCorridorRow): {
  asset: string;
  country: string;
  destinationType: string;
  beneficiaryType: string;
  payoutRailLabel: string | null;
  amount: PalremitCorridorAmount;
} {
  return {
    asset: row.target_fiat,
    country: row.country,
    destinationType: row.destination_type,
    beneficiaryType: row.beneficiary_type,
    payoutRailLabel: row.payout_rail_label ?? null,
    amount: row.amount,
  };
}

export function mapPalremitCorridorDetailToApi(detail: PalremitCorridorDetailResponse): {
  corridor: {
    asset: string;
    country: string;
    destinationType: string;
    beneficiaryType: string;
    payoutRailLabel: string | null;
  };
  destinationFields: PalremitDestinationFieldDescriptor[];
  destinationTemplate: Record<string, unknown>;
  amount: PalremitCorridorAmount;
} {
  return {
    corridor: {
      asset: detail.corridor.target_fiat,
      country: detail.corridor.country,
      destinationType: detail.corridor.destination_type,
      beneficiaryType: detail.corridor.beneficiary_type,
      payoutRailLabel: detail.corridor.payout_rail_label ?? null,
    },
    destinationFields: detail.destination_fields,
    destinationTemplate: detail.destination_template,
    amount: detail.amount,
  };
}
