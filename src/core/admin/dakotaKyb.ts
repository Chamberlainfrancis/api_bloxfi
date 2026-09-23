/**
 * Admin dashboard: proxy Dakota KYB attestation APIs on the orchestrator.
 * Tokens never leave the orchestrator.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { extractPalremitErrorMessage } from '@/services/palremitErrorMessage';

export type DakotaKybResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; message: string };

export interface DakotaKybAgreement {
  type: string;
  title: string;
  description: string;
  version: string | null;
  required: boolean;
}

export interface DakotaKybApplicant {
  customer_id: string;
  application_id: string;
  name: string;
  customer_type: string;
  kyb_status: string | null;
  application_status: string | null;
  applicant_id: string | null;
  applicant_name: string | null;
  missing_attestations: string[];
  agreements: DakotaKybAgreement[];
  validation_ready: boolean;
  status_message: string | null;
}

export interface DakotaKybAttestResult {
  application_id: string;
  attested: string[];
  submitted: boolean;
  ready: boolean;
  status_message: string | null;
  missing_attestations: string[];
  missing_fields: string[];
  missing_documents: string[];
}

function fail<T>(status: number, data: unknown): DakotaKybResult<T> {
  return {
    ok: false,
    status,
    message: extractPalremitErrorMessage(data) ?? 'orchestrator rejected the request',
  };
}

export async function listDakotaKybApplicants(
  request: PalremitLiquidityRequestFn
): Promise<DakotaKybResult<{ items: DakotaKybApplicant[] }>> {
  const res = await request<{ items?: DakotaKybApplicant[] }>(
    '/v1/integrations/dakota/applications',
    { method: 'GET' }
  );
  if (res.status !== 200) return fail(res.status, res.data);
  const items = Array.isArray(res.data?.items) ? res.data.items : [];
  return { ok: true, value: { items } };
}

export async function getDakotaKybApplicant(
  request: PalremitLiquidityRequestFn,
  applicationId: string
): Promise<DakotaKybResult<DakotaKybApplicant>> {
  const res = await request<DakotaKybApplicant>(
    `/v1/integrations/dakota/applications/${encodeURIComponent(applicationId)}`,
    { method: 'GET' }
  );
  if (res.status !== 200) return fail(res.status, res.data);
  return { ok: true, value: res.data };
}

export async function attestDakotaKybApplicant(
  request: PalremitLiquidityRequestFn,
  params: { applicationId: string; acceptedTypes: string[]; idempotencyKey: string }
): Promise<DakotaKybResult<DakotaKybAttestResult>> {
  const res = await request<DakotaKybAttestResult>(
    `/v1/integrations/dakota/applications/${encodeURIComponent(params.applicationId)}/attestations`,
    {
      method: 'POST',
      body: { accepted_types: params.acceptedTypes },
      headers: { 'Idempotency-Key': params.idempotencyKey },
    }
  );
  if (res.status !== 200) return fail(res.status, res.data);
  return { ok: true, value: res.data };
}
