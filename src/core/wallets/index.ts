/**
 * Core: external wallet management.
 * Pure business logic; no Express/Prisma/Redis.
 */

export { addExternalWallet } from "./addWallet";
export type { WalletRepoAdd } from "./addWallet";

export { listExternalWallets } from "./listWallets";
export type { WalletRepoList } from "./listWallets";

export { getExternalWallet } from "./getWallet";
export type { WalletRepoGet } from "./getWallet";

export { updateExternalWallet } from "./updateWallet";
export type { WalletRepoUpdate } from "./updateWallet";

export { deleteExternalWallet } from "./deleteWallet";
export type { WalletRepoDelete } from "./deleteWallet";
