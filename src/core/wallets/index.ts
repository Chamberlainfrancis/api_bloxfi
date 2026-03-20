/**
 * Core: external wallet management.
 * Pure business logic; no Express/Prisma/Redis.
 */

export { addExternalWallet } from "@/core/wallets/addWallet";
export type { WalletRepoAdd } from "@/core/wallets/addWallet";

export { listExternalWallets } from "@/core/wallets/listWallets";
export type { WalletRepoList } from "@/core/wallets/listWallets";

export { getExternalWallet } from "@/core/wallets/getWallet";
export type { WalletRepoGet } from "@/core/wallets/getWallet";

export { updateExternalWallet } from "@/core/wallets/updateWallet";
export type { WalletRepoUpdate } from "@/core/wallets/updateWallet";

export { deleteExternalWallet } from "@/core/wallets/deleteWallet";
export type { WalletRepoDelete } from "@/core/wallets/deleteWallet";
