import { describe, it, expect } from 'vitest';
import {
  createBeneficiaryBodySchema,
  listBeneficiariesQuerySchema,
} from '@/api/v1/beneficiaries/schemas';

const valid = {
  requestId: '705f1f8b-a080-467c-b683-174eca409928',
  userId: '9eea8cbd-e545-4d15-85cd-90690ede4b0c',
  customerType: 'individual' as const,
  sumsubShareToken: 'tok_abc',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '+15555550100',
};

describe('createBeneficiaryBodySchema', () => {
  it('accepts a valid individual payload', () => {
    expect(createBeneficiaryBodySchema.safeParse(valid).success).toBe(true);
  });

  it('rejects business customerType', () => {
    const r = createBeneficiaryBodySchema.safeParse({ ...valid, customerType: 'business' });
    expect(r.success).toBe(false);
  });

  it('rejects non-E.164 phone', () => {
    const r = createBeneficiaryBodySchema.safeParse({ ...valid, phone: '555-0100' });
    expect(r.success).toBe(false);
  });

  it('rejects non-uuid requestId', () => {
    const r = createBeneficiaryBodySchema.safeParse({ ...valid, requestId: 'not-a-uuid' });
    expect(r.success).toBe(false);
  });
});

describe('listBeneficiariesQuerySchema', () => {
  it('requires userId uuid', () => {
    expect(listBeneficiariesQuerySchema.safeParse({ userId: valid.userId }).success).toBe(true);
    expect(listBeneficiariesQuerySchema.safeParse({}).success).toBe(false);
  });
});
