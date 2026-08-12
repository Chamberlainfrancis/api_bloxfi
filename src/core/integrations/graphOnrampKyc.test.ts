import { describe, it, expect } from 'vitest';
import {
  assertGraphUsdAccountCreatePayload,
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
      expect(err.message).toContain('USD KYC validation failed');
      expect(err.message).toContain('is required');
      expect(err.fieldErrors.documents).toBe('required');
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
    expect(expectedMonthlyInflowFromSofBucket('50000_200000')).toBe(200000);
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

  it('maps any ISO alpha-2 address country (e.g. CY → CYP)', () => {
    const kyc = buildGraphIndividualKycInput({
      ...individualSource,
      accountHolder: {
        ...individualSource.accountHolder,
        phone: '+35799123456',
        idCountry: 'BE',
        address: {
          ...(individualSource.accountHolder as { address: object }).address,
          country: 'CY',
          stateProvinceRegion: '04',
        },
      },
    });
    expect(kyc.address_country).toBe('CYP');
    expect(kyc.id_country).toBe('BE');
  });

  it('reports invalid (not missing) when phone/country are present but unusable', () => {
    try {
      buildGraphIndividualKycInput({
        ...individualSource,
        accountHolder: {
          ...individualSource.accountHolder,
          phone: '0472070952',
          address: {
            ...(individualSource.accountHolder as { address: object }).address,
            country: 'ZZ',
          },
        },
      });
      expect.unreachable('expected GraphOnrampKycError');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      const err = e as GraphOnrampKycError;
      expect(err.message).toContain('USD KYC validation failed');
      expect(err.message).not.toContain('phone is required');
      expect(err.message).not.toContain('address_country is required');
      expect(err.fieldErrors.phone).toContain('E.164');
      expect(err.fieldErrors.address_country).toContain('ISO 3166');
      expect(err.missingFields).toEqual(expect.arrayContaining(['phone', 'address_country']));
    }
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

  it('dedupes Graph document types (keeps first when unsided)', () => {
    const kyc = buildGraphIndividualKycInput({
      ...individualSource,
      documents: [
        { type: 'national_id', url: 'https://cdn.example.com/id-front.png' },
        { type: 'national_id', url: 'https://cdn.example.com/id-back.png' },
        { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
      ],
    });
    expect(kyc.documents).toEqual([
      { type: 'national_id', url: 'https://cdn.example.com/id-front.png' },
      { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
    ]);
  });

  it('prefers side=front when front and back are both present', () => {
    const kyc = buildGraphIndividualKycInput({
      ...individualSource,
      documents: [
        { type: 'drivers_license', side: 'back', url: 'https://cdn.example.com/dl-back.jpg' },
        { type: 'drivers_license', side: 'front', url: 'https://cdn.example.com/dl-front.jpg' },
        { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
      ],
    });
    expect(kyc.documents).toEqual([
      { type: 'drivers_license', url: 'https://cdn.example.com/dl-front.jpg' },
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

describe('assertGraphUsdAccountCreatePayload', () => {
  it('accepts subdivision codes and allowlisted docs', () => {
    const kyc = assertGraphUsdAccountCreatePayload(individualSource);
    expect(kyc.address_state).toBe('LA');
  });

  it('rejects full state names', () => {
    try {
      assertGraphUsdAccountCreatePayload({
        ...individualSource,
        accountHolder: {
          ...individualSource.accountHolder,
          address: {
            ...(individualSource.accountHolder as { address: object }).address,
            stateProvinceRegion: 'Stockholm',
          },
        },
      });
      expect.unreachable('expected GraphOnrampKycError');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      expect((e as GraphOnrampKycError).missingFields).toContain('address_state');
    }
  });

  it('rejects source_of_funds document type and unsided duplicate identity docs', () => {
    try {
      assertGraphUsdAccountCreatePayload({
        ...individualSource,
        documents: [
          { type: 'national_id', url: 'https://cdn.example.com/id-front.png' },
          { type: 'national_id', url: 'https://cdn.example.com/id-back.png' },
          { type: 'source_of_funds', url: 'https://cdn.example.com/sof.pdf' },
        ],
      });
      expect.unreachable('expected GraphOnrampKycError');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      const fields = (e as GraphOnrampKycError).missingFields;
      expect(fields).toEqual(expect.arrayContaining(['documents[1].side', 'documents[2].type']));
    }
  });

  it('accepts complementary front+back of the same identity type', () => {
    const kyc = assertGraphUsdAccountCreatePayload({
      ...individualSource,
      documents: [
        { type: 'drivers_license', side: 'back', url: 'https://cdn.example.com/dl-back.jpg' },
        { type: 'drivers_license', side: 'front', url: 'https://cdn.example.com/dl-front.jpg' },
        { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
      ],
    });
    expect(kyc.documents).toEqual([
      { type: 'drivers_license', url: 'https://cdn.example.com/dl-front.jpg' },
      { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
    ]);
  });

  it('defaults omitted side to front so only back needs to be marked', () => {
    const kyc = assertGraphUsdAccountCreatePayload({
      ...individualSource,
      documents: [
        { type: 'drivers_license', url: 'https://cdn.example.com/dl-front.jpg' },
        { type: 'drivers_license', side: 'back', url: 'https://cdn.example.com/dl-back.jpg' },
        { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
      ],
    });
    expect(kyc.documents).toEqual([
      { type: 'drivers_license', url: 'https://cdn.example.com/dl-front.jpg' },
      { type: 'utility_bill', url: 'https://cdn.example.com/poa.pdf' },
    ]);
  });

  it('rejects two fronts of the same type', () => {
    try {
      assertGraphUsdAccountCreatePayload({
        ...individualSource,
        documents: [
          { type: 'drivers_license', side: 'front', url: 'https://cdn.example.com/dl-a.jpg' },
          { type: 'drivers_license', side: 'front', url: 'https://cdn.example.com/dl-b.jpg' },
        ],
      });
      expect.unreachable('expected GraphOnrampKycError');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      expect((e as GraphOnrampKycError).missingFields).toContain('documents[1].side');
    }
  });
});
