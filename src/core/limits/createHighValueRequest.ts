/**
 * Core: create high-value request (idempotent). Spec §6 POST /high-value-requests.
 */

import type {
  CreateHighValueRequestInput,
  CreateHighValueRequestResponse,
  HighValueRequestStatus,
} from '../../types/limits';

export interface HighValueRequestRepoCreate {
  createHighValueRequest(data: {
    requestId: string;
    userId: string;
    status: HighValueRequestStatus;
    currency?: string | null;
    requestedLimit?: string | null;
    reason?: string | null;
  }): Promise<{
    requestId: string;
    userId: string;
    status: string;
    createdAt: Date;
  }>;
  findHighValueRequestByRequestId(requestId: string): Promise<{
    requestId: string;
    userId: string;
    status: string;
    createdAt: Date;
  } | null>;
}

export async function createHighValueRequest(
  repo: HighValueRequestRepoCreate,
  requestId: string,
  input: Omit<CreateHighValueRequestInput, 'requestId'>
): Promise<CreateHighValueRequestResponse> {
  const existing = await repo.findHighValueRequestByRequestId(requestId);
  if (existing) {
    return {
      requestId: existing.requestId,
      userId: existing.userId,
      status: existing.status as HighValueRequestStatus,
      createdAt: existing.createdAt.toISOString(),
      message: 'High-value request already exists for this requestId.',
    };
  }

  const row = await repo.createHighValueRequest({
    requestId,
    userId: input.userId,
    status: 'pending',
    currency: input.currency ?? null,
    requestedLimit: input.requestedLimit ?? null,
    reason: input.reason ?? null,
  });

  return {
    requestId: row.requestId,
    userId: row.userId,
    status: row.status as HighValueRequestStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
