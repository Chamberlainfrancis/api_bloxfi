/**
 * Core: cancel offramp. Only allowed before crypto is received. Spec §5.5 POST /offramps/:id/cancel.
 */

import type {
  OfframpTransferDetails,
  OfframpSource,
  OfframpDestination,
  RateInformation,
  DepositInstructions,
  Timeline,
  OfframpFees,
  OfframpStatus,
  RefundDetails,
  CancelOfframpResponse,
} from '../../types/offramp';

const CANCELLABLE_STATUSES: OfframpStatus[] = ['CREATED', 'AWAITING_CRYPTO'];

export interface OfframpRepoGetAndUpdate {
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
  updateOfframpStatus(
    id: string,
    status: OfframpStatus,
    updates?: {
      timeline?: object | null;
      refundDetails?: object | null;
    }
  ): Promise<unknown>;
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

export async function cancelOfframp(
  repo: OfframpRepoGetAndUpdate,
  offrampId: string
): Promise<CancelOfframpResponse | null> {
  const row = await repo.findOfframpById(offrampId);
  if (!row) return null;

  const status = row.status as OfframpStatus;
  if (!CANCELLABLE_STATUSES.includes(status)) {
    throw new Error('OFFRAMP_NOT_CANCELLABLE');
  }

  const now = new Date();
  const timelineUpdate = (row.timeline as Record<string, unknown>) ?? {};
  const updatedTimeline = {
    ...timelineUpdate,
    cancelledAt: now.toISOString(),
  };
  const refundDetails: RefundDetails = {
    status: 'cancelled',
    refundedAt: now.toISOString(),
  };

  await repo.updateOfframpStatus(offrampId, 'CANCELLED', {
    timeline: updatedTimeline,
    refundDetails,
  });

  const updated = await repo.findOfframpById(offrampId);
  if (!updated) return null;

  return {
    transferType: 'OFFRAMP',
    transferDetails: rowToTransferDetails(updated),
    cancelled: true,
  };
}
