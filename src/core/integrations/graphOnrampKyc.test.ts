import { describe, it, expect } from 'vitest';
import {
  buildGraphBusinessKycInput,
  graphKycExtrasFromUserMetadata,
  GraphOnrampKycError,
} from '@/core/integrations/graphOnrampKyc';

const completeSource = {
  businessInfo: {
    legalName: 'BRIANA PAYMENTS LIMITED',
    registrationNumber: '14827391',
    entityType: 'LIMITED_COMPANY',
    dateOfIncorporation: '2023-03-15T00:00:00.000Z',
    taxIdentificationNumber: 'GB123456789',
    website: 'https://briana.example.test',
    industry: 'moneyTransferRemittance',
    email: 'ops@briana.example.test',
    phone: '+447700900123',
  },
  registeredAddress: {
    addressLine1: '1 Canada Square',
    city: 'London',
    stateProvinceRegion: 'ENG',
    postalCode: 'E14 5AB',
    country: 'GB',
  },
  legalRepresentative: {
    firstName: 'Adaeze',
    lastName: 'Okeke',
    email: 'adaeze@briana.example.test',
    phone: '+447700900456',
    dateOfBirth: '1990-05-12',
    address: {
      addressLine1: '10 Downing Street',
      city: 'London',
      stateProvinceRegion: 'ENG',
      postalCode: 'SW1A 2AA',
      country: 'GBR',
    },
  },
  documents: [{ type: 'passport', url: 'https://cdn.example.test/pass.jpg' }],
  background_information: {
    employment_status: 'employed' as const,
    primary_purpose: 'business' as const,
    source_of_funds: 'business' as const,
    expected_monthly_inflow: 40_000,
  },
  ubo: {
    id_type: 'passport' as const,
    id_number: 'P123456',
    id_country: 'GB',
  },
  business_id_type: 'registration_certificate',
};

describe('buildGraphBusinessKycInput', () => {
  it('builds a Graph business kyc_input from User fields + extras', () => {
    const kyc = buildGraphBusinessKycInput(completeSource);
    expect(kyc.customer_type).toBe('business');
    expect(kyc.entity_name).toBe('BRIANA PAYMENTS LIMITED');
    expect(kyc.jurisdiction).toBe('GB');
    expect(kyc.address_country).toBe('GBR');
    expect(kyc.business_dof).toBe('2023-03-15');
    expect(kyc.websites).toEqual(['https://briana.example.test']);
    expect((kyc.ubo as Record<string, unknown>).id_country).toBe('GB');
    expect((kyc.ubo as Record<string, unknown>).address_country).toBe('GBR');
  });

  it('fails closed listing missing Graph fields (no invented document URLs)', () => {
    expect(() =>
      buildGraphBusinessKycInput({
        businessInfo: completeSource.businessInfo,
        registeredAddress: completeSource.registeredAddress,
        legalRepresentative: completeSource.legalRepresentative,
        business_id_type: 'registration_certificate',
      })
    ).toThrow(GraphOnrampKycError);

    try {
      buildGraphBusinessKycInput({
        businessInfo: completeSource.businessInfo,
        registeredAddress: completeSource.registeredAddress,
        legalRepresentative: completeSource.legalRepresentative,
        business_id_type: 'registration_certificate',
      });
    } catch (e) {
      const err = e as GraphOnrampKycError;
      expect(err.missingFields).toEqual(
        expect.arrayContaining(['documents', 'background_information', 'ubo.id_type', 'ubo.id_number'])
      );
    }
  });
});

describe('graphKycExtrasFromUserMetadata', () => {
  it('reads graphOnrampKyc extras from User.metadata', () => {
    const extras = graphKycExtrasFromUserMetadata({
      graphOnrampKyc: {
        documents: [{ type: 'passport', url: 'https://cdn.example.test/x.jpg' }],
        background_information: completeSource.background_information,
        ubo: { id_type: 'passport', id_number: 'X1', id_country: 'US' },
        business_id_type: 'ein',
      },
    });
    expect(extras.documents).toHaveLength(1);
    expect(extras.business_id_type).toBe('ein');
    expect(extras.ubo?.id_number).toBe('X1');
  });

  it('returns empty when metadata has no graphOnrampKyc', () => {
    expect(graphKycExtrasFromUserMetadata({ foo: 1 })).toEqual({});
    expect(graphKycExtrasFromUserMetadata(null)).toEqual({});
  });
});
