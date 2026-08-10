/**
 * Palremit Liquidity — POST /v1/integrations/swipelux/kyc-import
 * (Sumsub share-token beneficiary KYC). Never logs the import token.
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
}

export type SwipeluxKycImportResult =
  | { ok: true; value: SwipeluxKycImportSuccess }
  | { ok: false; status: number; message: string };

export async function importSwipeluxBeneficiaryKyc(
  request: PalremitLiquidityRequestFn,
  body: {
    clientReference: string;
    importToken: string;
    kycInput: SwipeluxBeneficiaryKycInput;
  }
): Promise<SwipeluxKycImportResult> {
  const res = await request<{ channel_customer_id?: string; status?: string }>(
    '/v1/integrations/swipelux/kyc-import',
    {
      method: 'POST',
      body: {
        client_reference: body.clientReference,
        import_token: body.importToken,
        kyc_input: body.kycInput,
      },
    }
  );

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

  return {
    ok: true,
    value: {
      channel_customer_id: data.channel_customer_id,
      status: data.status,
    },
  };
}
