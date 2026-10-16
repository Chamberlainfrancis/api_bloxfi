import { describe, expect, it } from 'vitest';
import { findPairMarkup } from '@/core/quotes/pairMarkup';
import {
  FIAT_TO_FIAT_CONFIG,
  fiatToFiatOnrampWindowMinutes,
  fiatToFiatTransferTypeAllowed,
} from '@/config/fiatToFiat';

describe('findPairMarkup fiat-to-fiat flow', () => {
  it('matches the plain markup when no flow is set', () => {
    expect(findPairMarkup('USDT', 'EUR')?.markup).toBe(0.002);
  });

  it('multiplies the normal markup in the flow', () => {
    const m = FIAT_TO_FIAT_CONFIG.markupMultiplier;
    expect(findPairMarkup('USDT', 'EUR', 'FIAT_TO_FIAT')?.markup).toBeCloseTo(0.002 * m, 10);
    expect(findPairMarkup('EUR', 'USDT', 'FIAT_TO_FIAT')?.markup).toBeCloseTo(0.024 * m, 10);
  });

  it('ignores unknown flow values and pairs with no rule', () => {
    expect(findPairMarkup('USDT', 'EUR', 'OTHER')?.markup).toBe(0.002);
    expect(findPairMarkup('NGN', 'USDT', 'FIAT_TO_FIAT')).toBeNull();
  });
});

describe('fiat-to-fiat config helpers', () => {
  it('gives fast rails 1h and USD 24h; others are not allowed', () => {
    expect(fiatToFiatOnrampWindowMinutes('ngn')).toBe(60);
    expect(fiatToFiatOnrampWindowMinutes('GBP')).toBe(60);
    expect(fiatToFiatOnrampWindowMinutes('USD')).toBe(1440);
    expect(fiatToFiatOnrampWindowMinutes('EUR')).toBeNull();
  });

  it('allows only wire for USD', () => {
    expect(fiatToFiatTransferTypeAllowed('USD', 'WIRE')).toBe(true);
    expect(fiatToFiatTransferTypeAllowed('USD', 'ach')).toBe(false);
    expect(fiatToFiatTransferTypeAllowed('USD', undefined)).toBe(false);
    expect(fiatToFiatTransferTypeAllowed('NGN', undefined)).toBe(true);
  });
});
