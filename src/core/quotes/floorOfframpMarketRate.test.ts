import { describe, it, expect } from 'vitest';
import { floorOfframpMarketRate } from '@/core/quotes/floorOfframpMarketRate';

describe('floorOfframpMarketRate', () => {
  it('caps currency-api mid at the live executable OwlPay rate', () => {
    // OFF-c58b07a9: stale currency-api 0.870293 vs OwlPay SEPA 0.855861.
    expect(floorOfframpMarketRate(0.870293, 0.855861)).toBe(0.855861);
  });

  it('keeps currency-api when it is already at or below the executable rate', () => {
    expect(floorOfframpMarketRate(0.85, 0.855861)).toBe(0.85);
  });

  it('ignores a missing or unusable executable rate', () => {
    expect(floorOfframpMarketRate(0.870293, null)).toBe(0.870293);
    expect(floorOfframpMarketRate(0.870293, 0)).toBe(0.870293);
    expect(floorOfframpMarketRate(0.870293, Number.NaN)).toBe(0.870293);
  });
});
