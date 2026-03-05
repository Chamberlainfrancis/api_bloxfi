/**
 * Core: get single onramp by id. Spec §4.3 GET /onramps/:onrampId.
 */

import type {
  GetOnrampResponse,
  OnrampTransferDetails,
  OnrampSource,
  OnrampDestination,
  QuoteInformation,
  DepositInfo,
  Receipt,
  DeveloperFeeAmount,
  OnrampStatus,
} from '../../types/onramp';

export interface OnrampRepoGet {
  findOnrampById(id: string): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    quoteInformation: unknown;
    depositInfo: unknown;
    receipt: unknown;
    developerFee: unknown;
    failedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
}

function rowToTransferDetails(row: {
  id: string;
  requestId: string;
  status: string;
  source: unknown;
  destination: unknown;
  quoteInformation: unknown;
  depositInfo: unknown;
  receipt: unknown;
  developerFee: unknown;
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OnrampTransferDetails {
  return {
    id: row.id,
    requestId: row.requestId,
    status: row.status as OnrampStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OnrampSource,
    destination: row.destination as OnrampDestination,
    quoteInformation: row.quoteInformation as QuoteInformation,
    depositInfo: (row.depositInfo as DepositInfo) ?? null,
    receipt: (row.receipt as Receipt) ?? null,
    developerFee: (row.developerFee as DeveloperFeeAmount) ?? null,
    failedReason: row.failedReason ?? null,
  };
}

export async function getOnramp(
  repo: OnrampRepoGet,
  onrampId: string
): Promise<GetOnrampResponse | null> {
  const row = await repo.findOnrampById(onrampId);
  if (!row) return null;
  return {
    transferType: 'ONRAMP',
    transferDetails: rowToTransferDetails(row),
  };
}
