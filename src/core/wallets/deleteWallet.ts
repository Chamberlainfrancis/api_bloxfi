/**
 * Core: delete external wallet. Cannot delete if pending transactions.
 * Spec §2.5 Delete Wallet.
 */

import type { DeleteExternalWalletResponse } from '../../types/wallet';

export interface WalletRepoDelete {
  findExternalWalletByIdAndUser(
    walletId: string,
    userId: string
  ): Promise<{ id: string } | null>;
  hasPendingTransactions(walletId: string): Promise<boolean>;
  deleteExternalWallet(
    walletId: string,
    userId: string
  ): Promise<{ id: string; deletedAt: Date } | null>;
}

export async function deleteExternalWallet(
  repo: WalletRepoDelete,
  userId: string,
  walletId: string
): Promise<DeleteExternalWalletResponse | null> {
  const wallet = await repo.findExternalWalletByIdAndUser(walletId, userId);
  if (!wallet) return null;

  const pending = await repo.hasPendingTransactions(walletId);
  if (pending) {
    throw new Error('WALLET_HAS_PENDING_TRANSACTIONS');
  }

  const result = await repo.deleteExternalWallet(walletId, userId);
  if (!result) return null;

  return {
    id: result.id,
    deleted: true,
    deletedAt: result.deletedAt.toISOString(),
  };
}
