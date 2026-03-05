/**
 * Core: update external wallet metadata. Address and chain immutable.
 * Spec §2.4 Update Wallet.
 */

import type {
  UpdateExternalWalletRequest,
  UpdateExternalWalletResponse,
  BlockchainNetwork,
} from '../../types/wallet';

export interface WalletRepoUpdate {
  updateExternalWallet(
    walletId: string,
    userId: string,
    data: { name?: string; active?: boolean }
  ): Promise<{
    id: string;
    userId: string;
    address: string;
    chain: string;
    name: string;
    referenceId: string;
    active: boolean;
    createdAt: Date;
    updatedAt: Date | null;
  } | null>;
}

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
}): UpdateExternalWalletResponse {
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

export async function updateExternalWallet(
  repo: WalletRepoUpdate,
  userId: string,
  walletId: string,
  data: UpdateExternalWalletRequest
): Promise<UpdateExternalWalletResponse | null> {
  const updated = await repo.updateExternalWallet(walletId, userId, {
    name: data.name,
    active: data.active,
  });
  if (!updated) return null;
  return toExternalWallet(updated);
}
