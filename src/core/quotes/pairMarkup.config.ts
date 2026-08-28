/**
 * Corridor FX markup on currency-api marketRate.
 * 0.0025 = 25 bps, 0.024 = 2.4%. Same decimal-fraction convention as platformFee.
 * `sides` defaults to both buy (onramp) and sell (offramp).
 *
 * EUR onramp buy is 2.4% for every business (shared Iberbanco SEPA account),
 * including Graph/Bancara-pinned users. EUR offramp sell stays 25 bps.
 */
export interface PairMarkupRule {
  fiat: string;
  crypto: readonly string[];
  markup: number;
  sides?: readonly ('buy' | 'sell')[];
}

export const PAIR_MARKUP_RULES: readonly PairMarkupRule[] = [
  { fiat: 'EUR', crypto: ['USD', 'USDT', 'USDC'], markup: 0.024, sides: ['buy'] },
  { fiat: 'EUR', crypto: ['USD', 'USDT', 'USDC'], markup: 0.0025, sides: ['sell'] },
];
