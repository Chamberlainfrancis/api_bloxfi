import { describe, it, expect } from 'vitest';
import { validateDestinationAgainstCorridorFields } from '@/core/integrations/palremitCorridorValidate';

describe('validateDestinationAgainstCorridorFields', () => {
  const fields = [
    {
      path: 'bank_code',
      type: 'string',
      required: true,
      label: 'Bank code',
    },
    {
      path: 'account_number',
      type: 'string',
      required: true,
      label: 'Account number',
      minLength: 5,
    },
  ];

  it('accepts valid destination', () => {
    const r = validateDestinationAgainstCorridorFields(
      { bank_code: '058', account_number: '0123456789' },
      fields
    );
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects missing required fields', () => {
    const r = validateDestinationAgainstCorridorFields({ bank_code: '058' }, fields);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === 'account_number')).toBe(true);
  });

  it('does not enforce minLength (provider-owned value rule)', () => {
    const r = validateDestinationAgainstCorridorFields(
      { bank_code: '058', account_number: '1' },
      fields
    );
    expect(r.valid).toBe(true);
  });

  it('does not enforce enum membership for conditional fields', () => {
    const provinceFields = [
      {
        path: 'beneficiary.address.state_province',
        type: 'string',
        required: false,
        label: 'Province (ISO 3166-2)',
        conditional_required: [
          {
            when: { path: 'beneficiary.address.country', equals: 'PH' },
            required: true as const,
            enum: [{ value: 'ABR' }, { value: 'AGN' }],
          },
        ],
      },
    ];
    const r = validateDestinationAgainstCorridorFields(
      {
        beneficiary: { address: { country: 'PH', state_province: 'NEC' } },
      },
      provinceFields
    );
    expect(r.valid).toBe(true);
  });

  it('still requires conditionally-required fields when the condition matches', () => {
    const provinceFields = [
      {
        path: 'beneficiary.address.state_province',
        type: 'string',
        required: false,
        label: 'Province (ISO 3166-2)',
        conditional_required: [
          {
            when: { path: 'beneficiary.address.country', equals: 'PH' },
            required: true as const,
          },
        ],
      },
    ];
    const r = validateDestinationAgainstCorridorFields(
      { beneficiary: { address: { country: 'PH' } } },
      provinceFields
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.path === 'beneficiary.address.state_province')).toBe(true);
  });
});
