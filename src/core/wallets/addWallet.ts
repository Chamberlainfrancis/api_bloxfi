/**
 * Core: add external wallet. Pure logic; depends on repository (DI).
 * Spec §2.1 Add External Wallet.
 */

import type {
  AddExternalWalletRequest,
  AddExternalWalletResponse,
  BlockchainNetwork,
} from '@/types/wallet';

export interface WalletRepoAdd {
  createExternalWallet(data: {
    userId: string;
    address: string;
    chain: BlockchainNetwork;
    name: string;
    referenceId: string;
    memo?: string | null;
    active?: boolean;
  }): Promise<{
    id: string;
    userId: string;
    address: string;
    memo: string | null;
    chain: string;
    name: string;
    referenceId: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date | null;
  }>;
}

function toExternalWallet(row: {
  id: string;
  userId: string;
  address: string;
  memo: string | null;
  chain: string;
  name: string;
  referenceId: string;
  active: boolean;
  createdAt: Date;
  updatedAt: Date | null;
}): AddExternalWalletResponse {
  return {
    id: row.id,
    userId: row.userId,
    address: row.address,
    ...(row.memo != null && row.memo !== '' ? { memo: row.memo } : {}),
    chain: row.chain as BlockchainNetwork,
    name: row.name,
    referenceId: row.referenceId,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

export async function addExternalWallet(
  repo: WalletRepoAdd,
  userId: string,
  data: AddExternalWalletRequest
): Promise<AddExternalWalletResponse> {
  const wallet = await repo.createExternalWallet({
    userId,
    address: data.address,
    chain: data.chain,
    name: data.name,
    referenceId: data.referenceId,
    memo: typeof data.memo === 'string' && data.memo.trim() !== '' ? data.memo.trim() : undefined,
    active: true,
  });
  return toExternalWallet(wallet);
}
