/**
 * Core: get high-value request by requestId. Spec §6 GET /high-value-requests/:requestId.
 */

import type { GetHighValueRequestResponse, HighValueRequestStatus } from '../../types/limits';

export interface HighValueRequestRepoGet {
  findHighValueRequestByRequestId(requestId: string): Promise<{
    requestId: string;
    userId: string;
    status: string;
    currency: string | null;
    requestedLimit: string | null;
    reason: string | null;
    createdAt: Date;
    updatedAt: Date;
    reviewedAt: Date | null;
  } | null>;
}

export async function getHighValueRequest(
  repo: HighValueRequestRepoGet,
  requestId: string
): Promise<GetHighValueRequestResponse | null> {
  const row = await repo.findHighValueRequestByRequestId(requestId);
  if (!row) return null;

  return {
    requestId: row.requestId,
    userId: row.userId,
    status: row.status as HighValueRequestStatus,
    currency: row.currency ?? undefined,
    requestedLimit: row.requestedLimit ?? undefined,
    reason: row.reason ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString(),
  };
}
