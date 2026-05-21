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
});
