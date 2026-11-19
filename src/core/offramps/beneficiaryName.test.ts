import { describe, expect, it } from 'vitest';

import {
  sanitizeBeneficiaryNameForTravelRule,
  sanitizeDestinationBeneficiaryName,
} from '@/core/offramps/beneficiaryName';

describe('sanitizeBeneficiaryNameForTravelRule', () => {
  it('rewrites the two names OwlPay rejected on 2026-11-19', () => {
    expect(sanitizeBeneficiaryNameForTravelRule('QINGDAO HAIR NATURE ARTS&CRAFTS CO.,LIMITED')).toBe(
      'QINGDAO HAIR NATURE ARTS AND CRAFTS CO., LIMITED'
    );
    expect(sanitizeBeneficiaryNameForTravelRule('CHONGQING LONCIN IMPORT&EXPORT CO.,LTD')).toBe(
      'CHONGQING LONCIN IMPORT AND EXPORT CO., LTD'
    );
  });

  it('replaces & regardless of surrounding spaces and collapses whitespace', () => {
    expect(sanitizeBeneficiaryNameForTravelRule('A & B TRADING')).toBe('A AND B TRADING');
    expect(sanitizeBeneficiaryNameForTravelRule('  ACME   CORP ')).toBe('ACME CORP');
  });

  it('leaves clean names untouched', () => {
    expect(sanitizeBeneficiaryNameForTravelRule('ACME CO., LTD')).toBe('ACME CO., LTD');
    expect(sanitizeBeneficiaryNameForTravelRule('Jane Doe')).toBe('Jane Doe');
  });
});

describe('sanitizeDestinationBeneficiaryName', () => {
  it('fixes beneficiary.name in place and ignores non-beneficiary shapes', () => {
    const destination: Record<string, unknown> = {
      beneficiary: { name: 'ARTS&CRAFTS CO.,LTD', email: 'a@b.c' },
    };
    sanitizeDestinationBeneficiaryName(destination);
    expect((destination.beneficiary as Record<string, unknown>).name).toBe(
      'ARTS AND CRAFTS CO., LTD'
    );

    const noBen: Record<string, unknown> = { fields: {} };
    expect(() => sanitizeDestinationBeneficiaryName(noBen)).not.toThrow();
  });
});
