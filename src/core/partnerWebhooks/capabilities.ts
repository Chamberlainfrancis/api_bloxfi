import { mapUsdNamedDepositCapability } from '@/core/accounts/accountCapabilities';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';
import type { AccountDepositDetails } from '@/types/account';

export type IssuanceCapabilityRow = {
  id?: string;
  userId?: string;
  providerIssuanceStatus?: string | null;
  depositDetails?: unknown;
  providerIssuanceFailureReason?: string | null;
};

function depositDetailsOf(row: IssuanceCapabilityRow): AccountDepositDetails | null {
  return row.depositDetails != null &&
    typeof row.depositDetails === 'object' &&
    !Array.isArray(row.depositDetails)
    ? (row.depositDetails as AccountDepositDetails)
    : null;
}

export function capabilityStatus(row: IssuanceCapabilityRow) {
  return mapUsdNamedDepositCapability({
    providerIssuanceStatus: row.providerIssuanceStatus,
    depositDetails: depositDetailsOf(row),
    providerIssuanceFailureReason: row.providerIssuanceFailureReason,
  });
}

export function capabilityStatusChanged(
  before: IssuanceCapabilityRow,
  after: IssuanceCapabilityRow
): boolean {
  return capabilityStatus(before).status !== capabilityStatus(after).status;
}

export function maybeScheduleAccountCapabilitiesUpdated(
  before: IssuanceCapabilityRow,
  after: IssuanceCapabilityRow & { id: string; userId: string }
): void {
  if (!capabilityStatusChanged(before, after)) return;
  const cap = capabilityStatus(after);
  const data: Record<string, unknown> = {
    accountId: after.id,
    userId: after.userId,
    capabilities: { usdNamedDeposit: cap },
  };
  if (cap.status === 'active') {
    const details = depositDetailsOf(after);
    if (details) data.depositDetails = details;
  }
  schedulePartnerWebhook('account.capabilities.updated', data);
}
