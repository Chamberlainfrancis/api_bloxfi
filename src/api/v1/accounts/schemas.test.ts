import { describe, it, expect } from 'vitest';
import { createAccountBodySchema, updateAccountBodySchema } from '@/api/v1/accounts/schemas';

const onrampSof = {
  employmentStatus: 'employed' as const,
  expectedMonthlyPayments: '0_4999' as const,
  primaryPurpose: 'personal' as const,
  sourceOfFunds: 'salary' as const,
};

const onrampBase = {
  rail: 'onramp' as const,
  type: 'sumsub_kyc_import',
  accountHolder: {
    type: 'individual' as const,
    name: 'Matisse Eykelberg',
    firstName: 'Matisse',
    lastName: 'Eykelberg',
    email: 'matisse@example.com',
    taxId: '123-45-6789',
  },
  sumsubShareToken: 'share-tok-123',
  sofQuestionnaire: onrampSof,
  sourceOfFundsDocument: 'https://cdn.example.com/docs/sof.pdf',
};

describe('createAccountBodySchema', () => {
  it('accepts corridor + destination', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'offramp',
      type: 'usd_ge_wire_business',
      accountHolder: { type: 'business', name: 'ACME Georgia LLC' },
      corridor: {
        asset: 'USD',
        country: 'GE',
        destinationType: 'wire',
        beneficiaryType: 'business',
      },
      destination: {
        account_number: 'GE00TB1234567890123456',
        bank_code: 'TBCBGE22',
        bank_name: 'TBC Bank',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.corridor?.asset).toBe('USD');
      expect(r.data.corridor?.country).toBe('GE');
    }
  });

  it('rejects corridor without destination', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'offramp',
      type: 'x',
      accountHolder: { type: 'business', name: 'ACME' },
      corridor: {
        asset: 'USD',
        country: 'GE',
        destinationType: 'wire',
        beneficiaryType: 'business',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects legacy details-only body', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'offramp',
      type: 'nigeria',
      accountHolder: { type: 'business', name: 'Acme' },
      details: {
        currency: 'NGN',
        country: 'NG',
        accountNumber: '0123456789',
        bankCode: '058',
      },
    });
    expect(r.success).toBe(false);
  });

  it('accepts a well-formed onramp body without corridor/destination', () => {
    const r = createAccountBodySchema.safeParse(onrampBase);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.corridor).toBeUndefined();
      expect(r.data.destination).toBeUndefined();
      expect(r.data.sumsubShareToken).toBe('share-tok-123');
      expect(r.data.accountHolder.taxId).toBe('123-45-6789');
      expect(r.data.sofQuestionnaire?.employmentStatus).toBe('employed');
    }
  });

  it('accepts sourceOfFundsDocument inside sofQuestionnaire only', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      sourceOfFundsDocument: undefined,
      sofQuestionnaire: {
        ...onrampSof,
        sourceOfFundsDocument: 'https://cdn.example.com/nested-sof.pdf',
      },
    });
    expect(r.success).toBe(true);
  });

  it('accepts onramp body missing sumsubShareToken', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      sumsubShareToken: undefined,
    });
    expect(r.success).toBe(true);
  });

  it('accepts free-text mostRecentOccupation (Graph)', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      sofQuestionnaire: {
        ...onrampSof,
        mostRecentOccupation: 'test-occupation',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.sofQuestionnaire?.mostRecentOccupation).toBe('test-occupation');
    }
  });

  it('rejects onramp body missing sofQuestionnaire', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      sofQuestionnaire: undefined,
    });
    expect(r.success).toBe(false);
  });

  it('accepts onramp body missing accountHolder.taxId (optional unless SwipeLux import)', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      accountHolder: {
        type: 'individual',
        name: 'Matisse Eykelberg',
        firstName: 'Matisse',
        lastName: 'Eykelberg',
        email: 'matisse@example.com',
        taxId: '',
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.accountHolder.taxId).toBeUndefined();
    }
  });

  it('accepts Graph individual identity fields + metadata.documents', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      accountHolder: {
        type: 'individual',
        name: 'Takeshi Kovacs',
        firstName: 'Takeshi',
        lastName: 'Kovacs',
        middleName: 'Koo',
        email: 'test@example.com',
        phone: '+2348024056288',
        dateOfBirth: '1989-01-16',
        idType: 'passport',
        idNumber: 'A12345678',
        idCountry: 'NG',
        taxId: '',
        address: {
          addressLine1: 'Juncal 2091',
          city: 'Lagos',
          stateProvinceRegion: 'LA',
          postalCode: '100001',
          country: 'NG',
        },
      },
      metadata: {
        documents: [
          { type: 'passport', url: 'https://cdn.example.com/passport.png' },
          { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
        ],
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.accountHolder.dateOfBirth).toBe('1989-01-16');
      expect(r.data.accountHolder.idType).toBe('passport');
      expect(r.data.metadata?.documents).toHaveLength(2);
    }
  });

  it('rejects invalid accountHolder.idType', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      accountHolder: {
        ...onrampBase.accountHolder,
        idType: 'drivers_licence',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects onramp body missing sourceOfFundsDocument everywhere', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      sourceOfFundsDocument: undefined,
      sofQuestionnaire: onrampSof,
    });
    expect(r.success).toBe(false);
  });

  it('rejects onramp body missing firstName/lastName', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      accountHolder: { type: 'individual', name: 'Matisse Eykelberg' },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.errors.map((e) => e.path.join('.'));
      expect(paths).toContain('accountHolder');
    }
  });

  it('rejects onramp body with accountHolder.type=business', () => {
    const r = createAccountBodySchema.safeParse({
      ...onrampBase,
      accountHolder: {
        type: 'business',
        name: 'Acme Inc',
        firstName: 'Matisse',
        lastName: 'Eykelberg',
      },
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.errors.map((e) => e.path.join('.'));
      expect(paths).toContain('accountHolder.type');
    }
  });

  it('does not require corridor/destination for onramp', () => {
    const r = createAccountBodySchema.safeParse(onrampBase);
    expect(r.success).toBe(true);
  });
});

describe('updateAccountBodySchema', () => {
  it('accepts non-empty destination patch', () => {
    const r = updateAccountBodySchema.safeParse({
      destination: {
        beneficiary: { email: 'a@b.com', phone_number: '+971501234567' },
      },
    });
    expect(r.success).toBe(true);
  });

  it('rejects empty destination', () => {
    const r = updateAccountBodySchema.safeParse({ destination: {} });
    expect(r.success).toBe(false);
  });
});
