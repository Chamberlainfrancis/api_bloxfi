/**
 * Core: get single external wallet. Spec §2.3 Get Single Wallet.
 */

import type {
  GetExternalWalletResponse,
  BlockchainNetwork,
} from '../../types/wallet';

export interface WalletRepoGet {
  findExternalWalletByIdAndUser(
    walletId: string,
    userId: string
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
}): GetExternalWalletResponse {
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

export async function getExternalWallet(
  repo: WalletRepoGet,
  userId: string,
  walletId: string
): Promise<GetExternalWalletResponse | null> {
  const wallet = await repo.findExternalWalletByIdAndUser(walletId, userId);
  if (!wallet) return null;
  return toExternalWallet(wallet);
}
