/**
 * Shape of a pair markup rule. The values live in the PairMarkupSetting table
 * and are edited on the dashboard Rates tab; there are no rates in code.
 * `markup` is a decimal fraction: 0.002 = 20 bps. `sides` defaults to both
 * buy (onramp) and sell (offramp).
 */
export interface PairMarkupRule {
  fiat: string;
  crypto: readonly string[];
  markup: number;
  sides?: readonly ('buy' | 'sell')[];
  /**
   * Offramp only. true (default): refuse to quote without the payout
   * provider's live executable rate, and take the markup off
   * min(market, provider rate). false: take the markup off the market rate,
   * then cap the result at the provider rate when there is one (how the
   * currency-api B2B rate was priced for GBP, NGN, CNY, ...).
   */
  requireProviderRate?: boolean;
}
