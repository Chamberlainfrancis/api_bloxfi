/**
 * Core: list onramps with filters and cursor pagination. Spec §4.4 GET /onramps.
 */

import type { ListOnrampsQuery, ListOnrampsResponse, ListOnrampItem, OnrampStatus } from '../../types/onramp';

export interface OnrampRepoList {
  listOnramps(params: {
    userId?: string;
    status?: OnrampStatus;
    currency?: string;
    limit: number;
    createdBefore?: Date;
    createdAfter?: Date;
  }): Promise<{
    onramps: Array<{
      id: string;
      status: string;
      createdAt: Date;
      source: unknown;
      destination: unknown;
    }>;
    nextCursor: Date | null;
  }>;
}

function toListItem(row: {
  id: string;
  status: string;
  createdAt: Date;
  source: unknown;
  destination: unknown;
}): ListOnrampItem {
  const source = row.source as { currency?: string; amount?: number };
  const destination = row.destination as { currency?: string; amount?: number; chain?: string };
  return {
    id: row.id,
    status: row.status as OnrampStatus,
    createdAt: row.createdAt.toISOString(),
    source: {
      currency: source?.currency ?? '',
      amount: Number(source?.amount) ?? 0,
    },
    destination: {
      currency: destination?.currency ?? '',
      amount: Number(destination?.amount) ?? 0,
      chain: destination?.chain ?? '',
    },
  };
}

export async function listOnramps(
  repo: OnrampRepoList,
  query: ListOnrampsQuery
): Promise<ListOnrampsResponse> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
  const createdBefore = query.createdBefore ? new Date(query.createdBefore) : undefined;
  const createdAfter = query.createdAfter ? new Date(query.createdAfter) : undefined;
  if (createdBefore && isNaN(createdBefore.getTime())) {
    throw new Error('INVALID_CURSOR: createdBefore must be valid ISO 8601');
  }
  if (createdAfter && isNaN(createdAfter.getTime())) {
    throw new Error('INVALID_CURSOR: createdAfter must be valid ISO 8601');
  }

  const { onramps, nextCursor } = await repo.listOnramps({
    userId: query.userId,
    status: query.status,
    currency: query.currency,
    limit,
    createdBefore,
    createdAfter,
  });

  return {
    count: onramps.length,
    onramps: onramps.map(toListItem),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}
