/**
 * Core: get single onramp by id. Spec §4.3 GET /onramps/:onrampId.
 */

import { resolveOnrampFees } from '@/core/onramps/resolveOnrampFees';
import { expireOnrampIfDepositPastDue } from '@/core/ramps/depositExpiry';
import type {
  GetOnrampResponse,
  OnrampTransferDetails,
  OnrampSource,
  OnrampDestination,
  QuoteInformation,
  DepositInfo,
  Receipt,
  OnrampStatus,
} from '@/types/onramp';

export interface OnrampRepoGet {
  findOnrampById(id: string): Promise<{
    id: string;
    requestId: string;
    txnRef: string | null;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    quoteInformation: unknown;
    depositInfo: unknown;
    receipt: unknown;
    fees: unknown;
    developerFee: unknown;
    failedReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  } | null>;
  updateOnrampStatus(
    id: string,
    status: OnrampStatus,
    updates?: { failedReason?: string | null }
  ): Promise<unknown>;
}

function rowToTransferDetails(row: {
  id: string;
  requestId: string;
  txnRef: string | null;
  status: string;
  source: unknown;
  destination: unknown;
  quoteInformation: unknown;
  depositInfo: unknown;
  receipt: unknown;
  fees: unknown;
  developerFee: unknown;
  failedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}): OnrampTransferDetails {
  const ref = row.txnRef ?? '';
  return {
    id: row.id,
    requestId: row.requestId,
    txnRef: ref,
    clientReference: ref,
    status: row.status as OnrampStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    source: row.source as OnrampSource,
    destination: row.destination as OnrampDestination,
    quoteInformation: row.quoteInformation as QuoteInformation,
    depositInfo: (row.depositInfo as DepositInfo) ?? null,
    receipt: (row.receipt as Receipt) ?? null,
    fees: resolveOnrampFees(row),
    failedReason: row.failedReason ?? null,
  };
}

export async function getOnramp(
  repo: OnrampRepoGet,
  onrampId: string
): Promise<GetOnrampResponse | null> {
  const row = await repo.findOnrampById(onrampId);
  if (!row) return null;
  await expireOnrampIfDepositPastDue(row, repo);
  const current = (await repo.findOnrampById(onrampId)) ?? row;
  return {
    transferType: 'ONRAMP',
    transferDetails: rowToTransferDetails(current),
  };
}
