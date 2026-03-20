/**
 * Core: fiat account management. Spec §3.
 * Pure business logic; no Express/Prisma/Redis.
 */

export { createAccount } from '@/core/accounts/createAccount';
export type { AccountRepoCreate, UserRepoForAccount, KybRepoForAccount } from '@/core/accounts/createAccount';

export { listAccounts } from '@/core/accounts/listAccounts';
export type { AccountRepoList } from '@/core/accounts/listAccounts';

export { getAccount } from '@/core/accounts/getAccount';
export type { AccountRepoGet } from '@/core/accounts/getAccount';

export { deleteAccount } from '@/core/accounts/deleteAccount';
export type { AccountRepoDelete } from '@/core/accounts/deleteAccount';
