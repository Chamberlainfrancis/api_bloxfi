/**
 * Core: list offramps with filters and cursor pagination. Spec §5.4 GET /offramps.
 */

import type {
  ListOfframpsQuery,
  ListOfframpsResponse,
  ListOfframpItem,
  OfframpStatus,
} from '../../types/offramp';

export interface OfframpRepoList {
  listOfframps(params: {
    userId?: string;
    status?: OfframpStatus;
    currency?: string;
    limit: number;
    createdBefore?: Date;
    createdAfter?: Date;
  }): Promise<{
    offramps: Array<{
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
}): ListOfframpItem {
  const source = row.source as { currency?: string; amount?: number; chain?: string };
  const destination = row.destination as { currency?: string; amount?: number };
  return {
    id: row.id,
    status: row.status as OfframpStatus,
    createdAt: row.createdAt.toISOString(),
    source: {
      currency: source?.currency ?? '',
      amount: Number(source?.amount) ?? 0,
      chain: source?.chain ?? '',
    },
    destination: {
      currency: destination?.currency ?? '',
      amount: Number(destination?.amount) ?? 0,
    },
  };
}

export async function listOfframps(
  repo: OfframpRepoList,
  query: ListOfframpsQuery
): Promise<ListOfframpsResponse> {
  const limit = Math.min(Math.max(1, query.limit ?? 50), 100);
  const createdBefore = query.createdBefore ? new Date(query.createdBefore) : undefined;
  const createdAfter = query.createdAfter ? new Date(query.createdAfter) : undefined;
  if (createdBefore && isNaN(createdBefore.getTime())) {
    throw new Error('INVALID_CURSOR: createdBefore must be valid ISO 8601');
  }
  if (createdAfter && isNaN(createdAfter.getTime())) {
    throw new Error('INVALID_CURSOR: createdAfter must be valid ISO 8601');
  }

  const { offramps, nextCursor } = await repo.listOfframps({
    userId: query.userId,
    status: query.status,
    currency: query.currency,
    limit,
    createdBefore,
    createdAfter,
  });

  return {
    count: offramps.length,
    offramps: offramps.map(toListItem),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}
