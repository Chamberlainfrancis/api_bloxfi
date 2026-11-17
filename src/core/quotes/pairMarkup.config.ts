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
   * Offramp only: refuse to quote unless the payout provider returns a live
   * executable rate to cap the customer rate at. Defaults to true.
   */
  requireProviderRate?: boolean;
}
