/**
 * Corridor FX markup on currency-api marketRate.
 * 0.0025 = 25 bps. Same decimal-fraction convention as platformFee.
 */
export interface PairMarkupRule {
  fiat: string;
  crypto: readonly string[];
  markup: number;
}

export const PAIR_MARKUP_RULES: readonly PairMarkupRule[] = [
  { fiat: 'EUR', crypto: ['USD', 'USDT', 'USDC'], markup: 0.0025 },
];
