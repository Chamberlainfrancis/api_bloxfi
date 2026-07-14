import { describe, it, expect } from 'vitest';
import { createAccountBodySchema, updateAccountBodySchema } from '@/api/v1/accounts/schemas';

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
    const r = createAccountBodySchema.safeParse({
      rail: 'onramp',
      type: 'sumsub_kyc_import',
      accountHolder: {
        type: 'individual',
        name: 'Matisse Eykelberg',
        firstName: 'Matisse',
        lastName: 'Eykelberg',
        email: 'matisse@example.com',
      },
      sumsubShareToken: 'share-tok-123',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.corridor).toBeUndefined();
      expect(r.data.destination).toBeUndefined();
      expect(r.data.sumsubShareToken).toBe('share-tok-123');
    }
  });

  it('rejects onramp body missing sumsubShareToken', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'onramp',
      type: 'sumsub_kyc_import',
      accountHolder: {
        type: 'individual',
        name: 'Matisse Eykelberg',
        firstName: 'Matisse',
        lastName: 'Eykelberg',
      },
    });
    expect(r.success).toBe(false);
  });

  it('rejects onramp body missing firstName/lastName', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'onramp',
      type: 'sumsub_kyc_import',
      accountHolder: { type: 'individual', name: 'Matisse Eykelberg' },
      sumsubShareToken: 'share-tok-123',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.errors.map((e) => e.path.join('.'));
      expect(paths).toContain('accountHolder');
    }
  });

  it('rejects onramp body with accountHolder.type=business', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'onramp',
      type: 'sumsub_kyc_import',
      accountHolder: {
        type: 'business',
        name: 'Acme Inc',
        firstName: 'Matisse',
        lastName: 'Eykelberg',
      },
      sumsubShareToken: 'share-tok-123',
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.errors.map((e) => e.path.join('.'));
      expect(paths).toContain('accountHolder.type');
    }
  });

  it('does not require corridor/destination for onramp', () => {
    const r = createAccountBodySchema.safeParse({
      rail: 'onramp',
      type: 'sumsub_kyc_import',
      accountHolder: {
        type: 'individual',
        name: 'Matisse Eykelberg',
        firstName: 'Matisse',
        lastName: 'Eykelberg',
      },
      sumsubShareToken: 'share-tok-123',
    });
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
