/**
 * External wallet types per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md §2.
 */

export type BlockchainNetwork =
  | 'POLYGON'
  | 'ETHEREUM'
  | 'BASE'
  | 'SOLANA'
  | 'ARBITRUM'
  | 'OPTIMISM'
  | 'AVALANCHE'
  | 'BNB_CHAIN';

export interface ExternalWallet {
  id: string;
  userId: string;
  address: string;
  chain: BlockchainNetwork;
  name: string;
  referenceId: string;
  active: boolean;
  createdAt: string; // ISO 8601
  updatedAt: string | null; // ISO 8601
}

// --- Add External Wallet (POST) ---

export interface AddExternalWalletRequest {
  address: string;
  chain: BlockchainNetwork;
  name: string;
  referenceId: string;
}

export type AddExternalWalletResponse = ExternalWallet;

// --- List External Wallets (GET) ---

export interface ListExternalWalletsQuery {
  limit?: number;
  createdBefore?: string; // ISO 8601 cursor
  chain?: BlockchainNetwork;
  active?: boolean;
}

export interface ListExternalWalletsResponse {
  count: number;
  externalWallets: ExternalWallet[];
  nextCursor: string | null; // ISO 8601 for createdBefore in next request
}

// --- Get Single Wallet (GET) ---

export type GetExternalWalletResponse = ExternalWallet;

// --- Update Wallet (PATCH) ---

export interface UpdateExternalWalletRequest {
  name?: string;
  active?: boolean;
}

export type UpdateExternalWalletResponse = ExternalWallet;

// --- Delete Wallet (DELETE) ---

export interface DeleteExternalWalletResponse {
  id: string;
  deleted: true;
  deletedAt: string; // ISO 8601
}
