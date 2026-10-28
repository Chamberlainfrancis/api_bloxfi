import { describe, it, expect } from 'vitest';
import { getLimits } from '@/core/limits/getLimits';

describe('getLimits', () => {
  it('advertises GHS onramp and offramp rails', () => {
    const ghs = getLimits().rails.find((r) => r.rail === 'GHS');
    expect(ghs).toMatchObject({
      rail: 'GHS',
      currency: 'GHS',
      highValueSupport: true,
      processingTime: '1-2 business days',
    });
    expect(ghs?.onramp).toEqual({
      minAmount: '100',
      maxAmount: '1000000',
      currency: 'GHS',
      dailyLimit: '600000',
      monthlyLimit: '6000000',
    });
    expect(ghs?.offramp).toEqual({
      minAmount: '100',
      maxAmount: '1000000',
      currency: 'GHS',
      dailyLimit: '600000',
      monthlyLimit: '6000000',
    });
  });

  it('advertises a JPY offramp rail without claiming onramp', () => {
    const jpy = getLimits().rails.find((r) => r.rail === 'JPY');
    expect(jpy).toMatchObject({
      rail: 'JPY',
      currency: 'JPY',
      highValueSupport: true,
      processingTime: '1-2 business days',
    });
    expect(jpy?.onramp).toBeUndefined();
    expect(jpy?.offramp).toEqual({
      minAmount: '1000',
      maxAmount: '46853070',
      currency: 'JPY',
      dailyLimit: '10000000',
      monthlyLimit: '46853070',
    });
  });

  it('advertises an AUD offramp rail without claiming onramp', () => {
    const aud = getLimits().rails.find((r) => r.rail === 'AUD');
    expect(aud).toMatchObject({
      rail: 'AUD',
      currency: 'AUD',
      highValueSupport: true,
      processingTime: '1-2 business days',
    });
    expect(aud?.onramp).toBeUndefined();
    expect(aud?.offramp).toEqual({
      minAmount: '100',
      maxAmount: '428610',
      currency: 'AUD',
      dailyLimit: '100000',
      monthlyLimit: '428610',
    });
  });
});
