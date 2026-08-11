/**
 * Partner-facing Account capabilities derived from Graph named-VA issuance fields.
 */

import type {
  AccountCapabilities,
  AccountDepositDetails,
  UsdNamedDepositCapability,
  UsdNamedDepositCapabilityStatus,
} from '@/types/account';
import { redactProviderNamesFromClientMessage } from '@/utils/redactProviderNames';

export function sanitizeCapabilityFailureReason(
  raw: string | null | undefined
): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Neutralize brands and internal GRAPH_* code prefixes for partner responses.
  const redacted = redactProviderNamesFromClientMessage(trimmed).replace(/\bGRAPH_/gi, '');
  return redacted.trim() || null;
}

export function mapUsdNamedDepositCapability(input: {
  providerIssuanceStatus?: string | null;
  depositDetails?: AccountDepositDetails | null;
  providerIssuanceFailureReason?: string | null;
}): UsdNamedDepositCapability {
  const statusRaw = (input.providerIssuanceStatus ?? '').toLowerCase();
  let status: UsdNamedDepositCapabilityStatus = 'not_started';
  if (statusRaw === 'failed') {
    status = 'failed';
  } else if (
    statusRaw === 'active' &&
    input.depositDetails != null &&
    typeof input.depositDetails.accountNumber === 'string' &&
    input.depositDetails.accountNumber.trim() !== ''
  ) {
    status = 'ready';
  } else if (statusRaw === 'pending' || statusRaw === 'active') {
    // active without deposit details is still waiting on instructions
    status = 'pending';
  }

  const failureReason =
    status === 'failed'
      ? sanitizeCapabilityFailureReason(input.providerIssuanceFailureReason)
      : null;

  return {
    status,
    ...(failureReason != null ? { failureReason } : { failureReason: null }),
  };
}

/** Build capabilities for Graph-eligible onramp Accounts; omit otherwise. */
export function buildAccountCapabilities(input: {
  graphUsdEligible: boolean;
  railType: string;
  providerIssuanceStatus?: string | null;
  depositDetails?: AccountDepositDetails | null;
  providerIssuanceFailureReason?: string | null;
}): AccountCapabilities | undefined {
  if (!input.graphUsdEligible || input.railType !== 'onramp') return undefined;
  return {
    usdNamedDeposit: mapUsdNamedDepositCapability({
      providerIssuanceStatus: input.providerIssuanceStatus,
      depositDetails: input.depositDetails,
      providerIssuanceFailureReason: input.providerIssuanceFailureReason,
    }),
  };
}
