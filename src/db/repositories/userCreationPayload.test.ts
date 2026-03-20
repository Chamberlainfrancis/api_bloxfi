import { describe, it, expect } from 'vitest';
import type { CreateUserRequest } from '@/types/user';
import {
  userCreationPayloadFingerprint,
  userCreationPayloadFingerprintFromRow,
  userCreationPayloadsMatch,
} from '@/db/repositories/userCreationPayload';

function sampleRequest(overrides?: Partial<CreateUserRequest>): CreateUserRequest {
  return {
    type: 'business',
    requestId: '705f1f8b-a080-467c-b683-174eca409928',
    businessInfo: {
      legalName: 'Acme Ltd',
      tradingName: 'Acme',
      registrationNumber: '123',
      entityType: 'LIMITED_COMPANY',
      dateOfIncorporation: '2020-01-15',
      taxIdentificationNumber: 'T1',
      industry: 'TECHNOLOGY',
      email: 'admin@acme.com',
      phone: '+440000',
    },
    registeredAddress: {
      addressLine1: '1 St',
      city: 'London',
      postalCode: 'E1',
      country: 'GBR',
    },
    legalRepresentative: {
      firstName: 'A',
      lastName: 'B',
      email: 'rep@acme.com',
      phone: '+440001',
      dateOfBirth: '1980-01-01',
      position: 'Director',
      address: {
        addressLine1: '2 St',
        city: 'London',
        postalCode: 'E2',
        country: 'GBR',
      },
    },
    metadata: { source: 'test' },
    ...overrides,
  };
}

describe('userCreationPayload', () => {
  it('matches row with different key order in stored businessInfo', () => {
    const req = sampleRequest();
    const row = {
      type: 'business',
      businessInfo: {
        email: 'admin@acme.com',
        legalName: 'Acme Ltd',
        industry: 'TECHNOLOGY',
        phone: '+440000',
        registrationNumber: '123',
        entityType: 'LIMITED_COMPANY',
        dateOfIncorporation: '2020-01-15',
        taxIdentificationNumber: 'T1',
        tradingName: 'Acme',
      },
      registeredAddress: req.registeredAddress,
      legalRepresentative: req.legalRepresentative,
      metadata: { source: 'test' },
    };
    expect(userCreationPayloadsMatch(row, req)).toBe(true);
  });

  it('differs when business email changes', () => {
    const a = sampleRequest();
    const b = sampleRequest({
      businessInfo: { ...sampleRequest().businessInfo, email: 'other@acme.com' },
    });
    expect(userCreationPayloadFingerprint(a)).not.toBe(userCreationPayloadFingerprint(b));
  });

  it('row fingerprint matches request when structurally same', () => {
    const req = sampleRequest();
    expect(
      userCreationPayloadFingerprintFromRow({
        type: 'business',
        businessInfo: req.businessInfo,
        registeredAddress: req.registeredAddress,
        legalRepresentative: req.legalRepresentative,
        metadata: req.metadata ?? null,
      })
    ).toBe(userCreationPayloadFingerprint(req));
  });
});
