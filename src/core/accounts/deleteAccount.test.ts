import { describe, it, expect, vi } from 'vitest';
import { deleteAccount } from '@/core/accounts/deleteAccount';

describe('deleteAccount', () => {
  it('calls the rail-agnostic findAccountByIdAndUser, then deletes (offramp, unchanged)', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue({ id: 'acc-1' });
    const hasPendingTransactions = vi.fn().mockResolvedValue(false);
    const remove = vi.fn().mockResolvedValue({ id: 'acc-1' });

    const result = await deleteAccount(
      { findAccountByIdAndUser, hasPendingTransactions, deleteAccount: remove },
      'user-1',
      'acc-1'
    );

    expect(findAccountByIdAndUser).toHaveBeenCalledWith('acc-1', 'user-1');
    expect(result).toEqual({ status: 'INACTIVE', message: 'Account deleted successfully', id: 'acc-1' });
  });

  it('deletes an onramp account (rail-agnostic lookup finds it where the offramp-only lookup would 404)', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue({ id: 'acc-2' });
    const hasPendingTransactions = vi.fn().mockResolvedValue(false);
    const remove = vi.fn().mockResolvedValue({ id: 'acc-2' });

    const result = await deleteAccount(
      { findAccountByIdAndUser, hasPendingTransactions, deleteAccount: remove },
      'user-1',
      'acc-2'
    );

    expect(result?.id).toBe('acc-2');
  });

  it('returns null when the account is not found', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue(null);
    const hasPendingTransactions = vi.fn();
    const remove = vi.fn();

    const result = await deleteAccount(
      { findAccountByIdAndUser, hasPendingTransactions, deleteAccount: remove },
      'user-1',
      'missing'
    );

    expect(result).toBeNull();
    expect(hasPendingTransactions).not.toHaveBeenCalled();
  });

  it('throws ACCOUNT_HAS_PENDING_TRANSACTIONS instead of deleting (unchanged)', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue({ id: 'acc-1' });
    const hasPendingTransactions = vi.fn().mockResolvedValue(true);
    const remove = vi.fn();

    await expect(
      deleteAccount(
        { findAccountByIdAndUser, hasPendingTransactions, deleteAccount: remove },
        'user-1',
        'acc-1'
      )
    ).rejects.toThrow('ACCOUNT_HAS_PENDING_TRANSACTIONS');
    expect(remove).not.toHaveBeenCalled();
  });
});
