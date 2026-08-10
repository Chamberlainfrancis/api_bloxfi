/**
 * Palremit Liquidity — POST /v1/integrations/swipelux/kyc-import
 * Share-token import when importToken is set; hosted KYC when omitted.
 * Never logs the import token.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { extractPalremitErrorMessage } from '@/services/palremitErrorMessage';

export interface SwipeluxBeneficiaryKycInput {
  customer_type: 'individual';
  email: string;
  first_name: string;
  last_name: string;
  phone: string;
  middle_name?: string;
  date_of_birth?: string;
  tax_id?: string;
  tax_id_country?: string;
  address_line1?: string;
  address_line2?: string;
  address_city?: string;
  address_state?: string;
  address_postal_code?: string;
  address_country?: string;
}

export interface SwipeluxKycImportSuccess {
  channel_customer_id: string;
  status: string;
  verification_url: string | null;
}

export type SwipeluxKycImportResult =
  | { ok: true; value: SwipeluxKycImportSuccess }
  | { ok: false; status: number; message: string };

export async function importSwipeluxBeneficiaryKyc(
  request: PalremitLiquidityRequestFn,
  body: {
    clientReference: string;
    /** Omit (or empty) to start hosted KYC. */
    importToken?: string;
    kycInput: SwipeluxBeneficiaryKycInput;
  }
): Promise<SwipeluxKycImportResult> {
  const payload: Record<string, unknown> = {
    client_reference: body.clientReference,
    kyc_input: body.kycInput,
  };
  const token = body.importToken?.trim();
  if (token) {
    payload.import_token = token;
  }

  const res = await request<{
    channel_customer_id?: string;
    status?: string;
    verification_url?: string | null;
  }>('/v1/integrations/swipelux/kyc-import', {
    method: 'POST',
    body: payload,
  });

  if (res.status !== 200) {
    return {
      ok: false,
      status: res.status,
      message: extractPalremitErrorMessage(res.data) ?? 'orchestrator rejected the request',
    };
  }

  const data = res.data;
  if (
    !data ||
    typeof data.channel_customer_id !== 'string' ||
    !data.channel_customer_id.trim() ||
    typeof data.status !== 'string'
  ) {
    return {
      ok: false,
      status: 502,
      message: 'orchestrator returned an invalid kyc-import response',
    };
  }

  const verificationUrl =
    typeof data.verification_url === 'string' && data.verification_url.trim()
      ? data.verification_url.trim()
      : null;

  return {
    ok: true,
    value: {
      channel_customer_id: data.channel_customer_id,
      status: data.status,
      verification_url: verificationUrl,
    },
  };
}
