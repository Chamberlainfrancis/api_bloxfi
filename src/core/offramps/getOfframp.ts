/**
 * Core: get single offramp by id. Spec §5.3 GET /offramps/:id.
 */

import type {
  GetOfframpResponse,
  OfframpTransferDetails,
  OfframpSource,
  OfframpDestination,
  RateInformation,
  DepositInstructions,
  Timeline,
  OfframpFees,
  OfframpStatus,
  RefundDetails,
} from '../../types/offramp';

export interface OfframpRepoGet {
  findOfframpById(id: string): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    rateInformation: unknown;
    depositInstructions: unknown;
    timeline: unknown;
    fees: unknown;
    receipt: unknown;
    refundDetails: unknown;
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
  rateInformation: unknown;
  depositInstructions: unknown;
  timeline: unknown;
  fees: unknown;
  receipt: unknown;
  refundDetails: unknown;
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OfframpTransferDetails {
  return {
    id: row.id,
    requestId: row.requestId,
    status: row.status as OfframpStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OfframpSource,
    destination: row.destination as OfframpDestination,
    rateInformation: row.rateInformation as RateInformation,
    depositInstructions: (row.depositInstructions as DepositInstructions) ?? null,
    timeline: (row.timeline as Timeline) ?? undefined,
    fees: (row.fees as OfframpFees) ?? null,
    receipt: (row.receipt as { transactionHash?: string }) ?? null,
    refundDetails: (row.refundDetails as RefundDetails) ?? null,
    failedReason: row.failedReason ?? null,
  };
}

export async function getOfframp(
  repo: OfframpRepoGet,
  offrampId: string
): Promise<GetOfframpResponse | null> {
  const row = await repo.findOfframpById(offrampId);
  if (!row) return null;
  return {
    transferType: 'OFFRAMP',
    transferDetails: rowToTransferDetails(row),
  };
}
