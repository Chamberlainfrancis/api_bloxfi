/**
 * Core: delete fiat account. Cannot delete if pending transactions. Spec §3.4.
 */

import type { DeleteAccountResponse } from '../../types/account';

export interface AccountRepoDelete {
  findAccountByIdAndUser(accountId: string, userId: string): Promise<{ id: string } | null>;
  hasPendingTransactions(accountId: string): Promise<boolean>;
  deleteAccount(accountId: string, userId: string): Promise<{ id: string } | null>;
}

export async function deleteAccount(
  repo: AccountRepoDelete,
  userId: string,
  accountId: string
): Promise<DeleteAccountResponse | null> {
  const account = await repo.findAccountByIdAndUser(accountId, userId);
  if (!account) return null;

  const pending = await repo.hasPendingTransactions(accountId);
  if (pending) {
    throw new Error('ACCOUNT_HAS_PENDING_TRANSACTIONS');
  }

  const result = await repo.deleteAccount(accountId, userId);
  if (!result) return null;

  return {
    status: 'INACTIVE',
    message: 'Account deleted successfully',
    id: result.id,
  };
}
