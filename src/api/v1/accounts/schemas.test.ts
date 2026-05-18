import { describe, it, expect } from 'vitest';
import { createAccountBodySchema } from '@/api/v1/accounts/schemas';

describe('createAccountBodySchema', () => {
  it('strips whitespace from bank identifiers on create', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'offramp',
      type: 'global_bank',
      accountHolder: { type: 'business', name: 'Viking Ploom' },
      details: {
        currency: 'USD',
        country: 'SE',
        accountNumber: 'SE68 5000 0000 0504 0114 3074',
        bankCode: 'ESSE SESS XXX',
        bankName: 'Skandinaviska Enskilda Banken AB',
        transferDetails: {
          payoutRail: 'WIRE',
          accountHolderName: 'Viking Ploom',
          beneficiary: {
            name: 'Viking Ploom',
            address: {
              street: 'Scheffersgatan 9',
              city: 'STOCKHOLM',
              stateProvince: 'SE',
              postalCode: '11258',
              country: 'SE',
            },
          },
        },
      },
    });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.details.accountNumber).toBe('SE6850000000050401143074');
    expect(r.data.details.bankCode).toBe('ESSESESSXXX');
  });
});
