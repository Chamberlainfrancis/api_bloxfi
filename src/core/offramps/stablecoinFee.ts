/**
 * USDT/USDC platform-fee settlement. 1.02 USDT per 1 USDC — not a live FX lookup.
 */

export const USDT_PER_USDC = 1.02;

export type StableFeeAsset = 'USDT' | 'USDC';

export function parseStableFeeAsset(raw: string | undefined): StableFeeAsset | null {
  const v = raw?.trim().toUpperCase();
  if (v === 'USDT' || v === 'USDC') return v;
  return null;
}

/** Convert a USDT/USDC fee amount. Same-asset is a no-op. */
export function convertUsdtUsdc(amount: number, from: StableFeeAsset, to: StableFeeAsset): number {
  if (!(Number.isFinite(amount) && amount > 0)) return amount;
  if (from === to) return amount;
  if (from === 'USDT' && to === 'USDC') return amount / USDT_PER_USDC;
  return amount * USDT_PER_USDC;
}
