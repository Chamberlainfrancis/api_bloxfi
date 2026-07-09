import { describe, it, expect } from 'vitest';
import { mergePalremitDestination } from '@/core/accounts/mergePalremitDestination';

describe('mergePalremitDestination', () => {
  const base = {
    account_number: 'AE910860000006648238946',
    bank_code: 'WIOBAEADXXX',
    bank_name: 'Wio Bank PJSC',
    account_holder_name: 'Matisse Eykelberg',
    beneficiary: {
      type: 'individual',
      name: 'Matisse Eykelberg',
      address: { street: 'Main', city: 'Dubai', country: 'AE' },
    },
  };

  it('merges top-level fields', () => {
    const out = mergePalremitDestination(base, { bank_name: 'Updated Bank' });
    expect(out.bank_name).toBe('Updated Bank');
    expect(out.account_number).toBe(base.account_number);
  });

  it('deep-merges beneficiary and address without dropping siblings', () => {
    const out = mergePalremitDestination(base, {
      beneficiary: {
        email: 'matisse@example.com',
        phone_number: '+971501234567',
        address: { postal_code: '0000' },
      },
    });
    const ben = out.beneficiary as Record<string, unknown>;
    const addr = ben.address as Record<string, unknown>;
    expect(ben.email).toBe('matisse@example.com');
    expect(ben.phone_number).toBe('+971501234567');
    expect(ben.name).toBe('Matisse Eykelberg');
    expect(addr.street).toBe('Main');
    expect(addr.postal_code).toBe('0000');
    expect(addr.country).toBe('AE');
  });

  it('merges extras', () => {
    const withExtras = { ...base, extras: { is_self_transfer: true } };
    const out = mergePalremitDestination(withExtras, {
      extras: { transfer_purpose: 'FAMILY_MAINTENANCE' },
    });
    expect(out.extras).toEqual({
      is_self_transfer: true,
      transfer_purpose: 'FAMILY_MAINTENANCE',
    });
  });
});
