/**
 * Which assets and chains a business wallet can be funded on, and how a
 * sender / withdrawal address is normalized per chain. Chain codes are the
 * orchestrator's network codes.
 */

import type { WalletAsset } from '@/db/repositories/businessWallet.repo';

/** Chains an admin may turn on per asset. */
export const WALLET_ALLOWED_CHAINS: Readonly<Record<WalletAsset, readonly string[]>> = Object.freeze({
  USDT: Object.freeze(['TRC20', 'ERC20', 'BEP20', 'MATIC']),
  USDC: Object.freeze(['ERC20', 'BASE', 'MATIC', 'BEP20']),
});

/** New wallets start with one chain per asset (Emmanuel, 19 Nov 2026). */
export const WALLET_DEFAULT_CHAINS: Readonly<Record<WalletAsset, readonly string[]>> = Object.freeze({
  USDT: Object.freeze(['TRC20']),
  USDC: Object.freeze(['ERC20']),
});

export type ChainFamily = 'evm' | 'tron';

export function chainFamily(chain: string): ChainFamily | null {
  const c = chain.trim().toUpperCase();
  if (c === 'TRC20' || c === 'TRON' || c === 'TRX') return 'tron';
  if (['ERC20', 'BEP20', 'MATIC', 'POLYGON', 'BASE', 'ARBITRUM', 'OPTIMISM', 'CELO', 'ETH', 'BSC'].includes(c)) return 'evm';
  return null;
}

export function isAllowedWalletChain(asset: WalletAsset, chain: string): boolean {
  return WALLET_ALLOWED_CHAINS[asset].includes(chain.trim().toUpperCase());
}

const EVM_RE = /^0x[0-9a-fA-F]{40}$/;
const TRON_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

/**
 * Canonical form used for whitelist matching: lower-case hex for EVM,
 * base58 as-is for Tron. Returns null when the address is not valid for
 * the chain.
 */
export function normalizeWalletAddress(chain: string, address: string): string | null {
  const a = (address ?? '').trim();
  const fam = chainFamily(chain);
  if (fam === 'evm') return EVM_RE.test(a) ? a.toLowerCase() : null;
  if (fam === 'tron') return TRON_RE.test(a) ? a : null;
  return null;
}

export function walletClientReference(userId: string): string {
  return `WAL-${userId}`;
}

const WAL_RE = /^WAL-([0-9a-fA-F-]{36})$/;

/** userId from a wallet client reference, or null. */
export function parseWalletClientReference(ref: string): string | null {
  const m = WAL_RE.exec(ref.trim());
  return m ? m[1]!.toLowerCase() : null;
}
