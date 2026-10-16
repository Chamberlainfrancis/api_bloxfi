import { describe, expect, it } from 'vitest';
import { findPairMarkup } from '@/core/quotes/pairMarkup';
import { FIAT_TO_FIAT_CONFIG } from '@/config/fiatToFiat';

describe('findPairMarkup fiat-to-fiat flow', () => {
  it('matches the plain markup when no flow is set', () => {
    expect(findPairMarkup('USDT', 'EUR')?.markup).toBe(0.002);
    expect(findPairMarkup('USDT', 'EUR', undefined)?.markup).toBe(0.002);
  });

  it('adds the configured extra markup for the flow', () => {
    const extra = FIAT_TO_FIAT_CONFIG.extraMarkup.sell;
    expect(findPairMarkup('USDT', 'EUR', 'FIAT_TO_FIAT')?.markup).toBeCloseTo(0.002 + extra, 10);
  });

  it('ignores unknown flow values', () => {
    expect(findPairMarkup('USDT', 'EUR', 'OTHER')?.markup).toBe(0.002);
  });
});
