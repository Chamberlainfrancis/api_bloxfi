import { describe, it, expect } from 'vitest';
import {
  buildGraphBusinessKycInput,
  buildGraphIndividualKycInput,
  expectedMonthlyInflowFromSofBucket,
  graphKycExtrasFromUserMetadata,
  GraphOnrampKycError,
  isGraphUsdNamedDepositsEnabled,
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
      expect(err.message.toLowerCase()).not.toContain('graph');
      expect(err.message).toContain('missing required fields for USD KYC');
      expect(err.code).toBe('USD_ONRAMP_KYC_INCOMPLETE');
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

const individualSource = {
  accountHolder: {
    type: 'individual',
    name: 'Takeshi Kovacs',
    firstName: 'Takeshi',
    lastName: 'Kovacs',
    middleName: 'Koo',
    email: 'test@example.com',
    phone: '+234 802 405 6288',
    dateOfBirth: '1989-01-16',
    idType: 'passport',
    idNumber: 'A12345678',
    idCountry: 'NG',
    taxId: '',
    address: {
      addressLine1: 'Juncal 2091',
      addressLine2: '',
      city: 'Lagos',
      stateProvinceRegion: 'LA',
      postalCode: '100001',
      country: 'NG',
    },
  },
  sofQuestionnaire: {
    employmentStatus: 'employed',
    expectedMonthlyPayments: '0_4999',
    primaryPurpose: 'personal',
    sourceOfFunds: 'salary',
    mostRecentOccupation: '151251',
  },
  documents: [
    { type: 'passport', url: 'https://cdn.example.com/passport.png' },
    { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
  ],
};

describe('expectedMonthlyInflowFromSofBucket', () => {
  it('takes the integer after _', () => {
    expect(expectedMonthlyInflowFromSofBucket('0_4999')).toBe(4999);
    expect(expectedMonthlyInflowFromSofBucket('5000_9999')).toBe(9999);
    expect(expectedMonthlyInflowFromSofBucket('10000_49999')).toBe(49999);
  });

  it('returns null for invalid buckets', () => {
    expect(expectedMonthlyInflowFromSofBucket('4999')).toBeNull();
    expect(expectedMonthlyInflowFromSofBucket('0_')).toBeNull();
  });
});

describe('isGraphUsdNamedDepositsEnabled', () => {
  it('reads User.metadata.graphUsdNamedDeposits', () => {
    expect(isGraphUsdNamedDepositsEnabled({ graphUsdNamedDeposits: true })).toBe(true);
    expect(isGraphUsdNamedDepositsEnabled({ graphUsdNamedDeposits: false })).toBe(false);
    expect(isGraphUsdNamedDepositsEnabled({})).toBe(false);
  });
});

describe('buildGraphIndividualKycInput', () => {
  it('builds Graph individual kyc_input from onramp Account fields', () => {
    const kyc = buildGraphIndividualKycInput(individualSource);
    expect(kyc.customer_type).toBe('individual');
    expect(kyc.first_name).toBe('Takeshi');
    expect(kyc.last_name).toBe('Kovacs');
    expect(kyc.middle_name).toBe('Koo');
    expect(kyc.phone).toBe('+2348024056288');
    expect(kyc.id_country).toBe('NG');
    expect(kyc.address_country).toBe('NGA');
    expect(kyc.address_line1).toBe('Juncal 2091');
    expect(kyc.background_information).toEqual({
      employment_status: 'employed',
      occupation: '151251',
      primary_purpose: 'personal',
      source_of_funds: 'salary',
      expected_monthly_inflow: 4999,
    });
    expect(kyc.documents).toEqual(individualSource.documents);
    expect(kyc.tax_id).toBeUndefined();
  });

  it('drops non-Graph document types and maps proof_of_address → utility_bill', () => {
    const kyc = buildGraphIndividualKycInput({
      ...individualSource,
      documents: [
        { type: 'passport', url: 'https://cdn.example.com/passport.png' },
        { type: 'source_of_funds', url: 'https://cdn.example.com/sof.pdf' },
        { type: 'proof_of_address', url: 'https://cdn.example.com/poa.pdf' },
      ],
    });
    expect(kyc.documents).toEqual([
      { type: 'passport', url: 'https://cdn.example.com/passport.png' },
      { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
    ]);
  });

  it('fails closed when identity docs / DOB / address missing', () => {
    try {
      buildGraphIndividualKycInput({
        accountHolder: {
          type: 'individual',
          name: 'Takeshi Kovacs',
          firstName: 'Takeshi',
          lastName: 'Kovacs',
          email: 'test@example.com',
          phone: '+2348024056288',
        },
        sofQuestionnaire: individualSource.sofQuestionnaire,
        documents: [],
      });
      expect.unreachable('expected GraphOnrampKycError');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      const err = e as GraphOnrampKycError;
      expect(err.missingFields).toEqual(
        expect.arrayContaining([
          'date_of_birth',
          'id_type',
          'id_number',
          'address_line1',
          'documents',
        ])
      );
    }
  });
});
