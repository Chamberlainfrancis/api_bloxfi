export type OnrampMarkupCapability = 'usdNamedDeposit';

export interface OnrampAccountMarkupRule {
  /** Source / fromCurrency, compared case-insensitively. */
  currency: string;
  capability: OnrampMarkupCapability;
  /**
   * Decimal fraction, same as platformFee PERCENTAGE.
   * 0.01 = 1%, 0.004 = 40 bps.
   */
  markup: number;
}

export const ONRAMP_ACCOUNT_MARKUP_RULES: readonly OnrampAccountMarkupRule[] = [
  { currency: 'USD', capability: 'usdNamedDeposit', markup: 0.004 },
];
