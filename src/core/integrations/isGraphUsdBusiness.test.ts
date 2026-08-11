import { describe, it, expect } from 'vitest';
import {
  BRIANA_BUSINESS_REFERENCE,
  CARLSTON_BUSINESS_REFERENCE,
  isGraphUsdBusiness,
} from '@/core/integrations/palremitOnramp';

describe('isGraphUsdBusiness', () => {
  it('pins Briana and Carlston without metadata', () => {
    expect(isGraphUsdBusiness(BRIANA_BUSINESS_REFERENCE, null)).toBe(true);
    expect(isGraphUsdBusiness(CARLSTON_BUSINESS_REFERENCE, {})).toBe(true);
  });

  it('opts in other businesses via metadata.graphUsdNamedDeposits', () => {
    expect(isGraphUsdBusiness('other-user', { graphUsdNamedDeposits: true })).toBe(true);
    expect(isGraphUsdBusiness('other-user', { graphUsdNamedDeposits: false })).toBe(false);
    expect(isGraphUsdBusiness('other-user', null)).toBe(false);
  });
});
