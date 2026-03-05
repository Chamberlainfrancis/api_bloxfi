/**
 * Core: list external wallets with cursor pagination and filters.
 * Spec §2.2 List External Wallets.
 */

import type {
  ListExternalWalletsQuery,
  ListExternalWalletsResponse,
  BlockchainNetwork,
} from '../../types/wallet';

export interface WalletRepoList {
  listExternalWallets(params: {
    userId: string;
    limit: number;
    createdBefore?: Date;
    chain?: BlockchainNetwork;
    active?: boolean;
  }): Promise<{
    wallets: Array<{
      id: string;
      userId: string;
      address: string;
      chain: string;
      name: string;
      referenceId: string;
      active: boolean;
      createdAt: Date;
      updatedAt: Date | null;
    }>;
    nextCursor: Date | null;
  }>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

function toExternalWallet(row: {
  id: string;
  userId: string;
  address: string;
  chain: string;
  name: string;
  referenceId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}) {
  return {
    id: row.id,
    userId: row.userId,
    address: row.address,
    chain: row.chain as BlockchainNetwork,
    name: row.name,
    referenceId: row.referenceId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function listExternalWallets(
  repo: WalletRepoList,
  userId: string,
  query: ListExternalWalletsQuery
): Promise<ListExternalWalletsResponse> {
  const limit = Math.min(
    Math.max(1, query.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT
  );
  const createdBefore = query.createdBefore
    ? new Date(query.createdBefore)
    : undefined;
  if (createdBefore && isNaN(createdBefore.getTime())) {
    throw new Error('INVALID_CURSOR: createdBefore must be valid ISO 8601');
  }
  const { wallets, nextCursor } = await repo.listExternalWallets({
    userId,
    limit,
    createdBefore,
    chain: query.chain,
    active: query.active,
  });
  return {
    count: wallets.length,
    externalWallets: wallets.map(toExternalWallet),
    nextCursor: nextCursor ? nextCursor.toISOString() : null,
  };
}
