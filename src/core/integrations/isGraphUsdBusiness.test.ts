import { describe, it, expect } from 'vitest';
import {
  BRIANA_BUSINESS_REFERENCE,
  CARLSTON_BUSINESS_REFERENCE,
  SMS_DATA_BUSINESS_REFERENCE,
  isDakotaUsdBusiness,
  isGraphUsdBusiness,
} from '@/core/integrations/palremitOnramp';

describe('isGraphUsdBusiness', () => {
  it('pins Briana, Carlston, and SMS Data without metadata', () => {
    expect(isGraphUsdBusiness(BRIANA_BUSINESS_REFERENCE, null)).toBe(true);
    expect(isGraphUsdBusiness(CARLSTON_BUSINESS_REFERENCE, {})).toBe(true);
    expect(isGraphUsdBusiness(SMS_DATA_BUSINESS_REFERENCE, null)).toBe(true);
  });

  it('opts in other businesses via metadata.graphUsdNamedDeposits', () => {
    expect(isGraphUsdBusiness('other-user', { graphUsdNamedDeposits: true })).toBe(true);
    expect(isGraphUsdBusiness('other-user', { graphUsdNamedDeposits: false })).toBe(false);
    expect(isGraphUsdBusiness('other-user', null)).toBe(false);
  });
});

describe('isDakotaUsdBusiness', () => {
  it('replaces Graph for Briana, Carlston, SMS Data, and the Graph opt-in', () => {
    expect(isDakotaUsdBusiness(BRIANA_BUSINESS_REFERENCE, null)).toBe(true);
    expect(isDakotaUsdBusiness(CARLSTON_BUSINESS_REFERENCE, {})).toBe(true);
    expect(isDakotaUsdBusiness(SMS_DATA_BUSINESS_REFERENCE, null)).toBe(true);
    expect(isDakotaUsdBusiness('other-user', { graphUsdNamedDeposits: true })).toBe(true);
  });

  it('opts in via metadata.dakotaUsdNamedDeposits', () => {
    expect(isDakotaUsdBusiness('other-user', { dakotaUsdNamedDeposits: true })).toBe(true);
    expect(isDakotaUsdBusiness('other-user', { dakotaUsdNamedDeposits: false })).toBe(false);
    expect(isDakotaUsdBusiness('other-user', null)).toBe(false);
  });
});
