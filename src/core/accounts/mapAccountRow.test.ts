import { describe, it, expect } from 'vitest';
import { mapAccountRowToApi, type AccountRowLike } from '@/core/accounts/mapAccountRow';

const offrampRow: AccountRowLike = {
  id: 'acc-1',
  userId: 'user-1',
  railType: 'offramp',
  currency: 'aed',
  paymentRail: 'local_bank',
  accountType: 'primary',
  accountHolder: { type: 'individual', name: 'Matisse Eykelberg' },
  providerPayout: {
    provider: 'palremit',
    schemaVersion: 2,
    corridor: {
      asset: 'AED',
      country: 'AE',
      destinationType: 'local_bank',
      beneficiaryType: 'individual',
    },
    destination: {
      account_number: 'AE910860000006648238946',
      bank_code: 'WIOBAEADXXX',
    },
  },
  createdAt: new Date('2026-05-22T00:00:00.000Z'),
  updatedAt: new Date('2026-05-22T00:00:00.000Z'),
};

const onrampRow: AccountRowLike = {
  id: 'acc-2',
  userId: 'user-1',
  railType: 'onramp',
  currency: '',
  paymentRail: '',
  accountType: 'sumsub_kyc_import',
  accountHolder: {
    type: 'individual',
    name: 'Matisse Eykelberg',
    firstName: 'Matisse',
    lastName: 'Eykelberg',
    taxId: '123-45-6789',
  },
  providerPayout: null,
  swipeluxCustomerId: 'cus_123',
  kycImportStatus: 'approved',
  sofQuestionnaire: {
    employmentStatus: 'employed',
    expectedMonthlyPayments: '0_4999',
    primaryPurpose: 'personal',
    sourceOfFunds: 'salary',
  },
  sourceOfFundsDocumentPath: 'uploads/DOC-sof.pdf',
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  updatedAt: new Date('2026-07-14T00:00:00.000Z'),
};

describe('mapAccountRowToApi', () => {
  it('maps an offramp row with a parsed providerPayout + derived details (unchanged)', () => {
    const result = mapAccountRowToApi(offrampRow, { mask: false });
    expect(result.rail.railType).toBe('offramp');
    expect(result.providerPayout?.destination.account_number).toBe('AE910860000006648238946');
    expect(result.details?.accountNumber).toBe('AE910860000006648238946');
  });

  it('throws ACCOUNT_MISSING_PROVIDER_PAYOUT for an offramp row with a null providerPayout (unchanged)', () => {
    expect(() =>
      mapAccountRowToApi({ ...offrampRow, providerPayout: null }, { mask: false })
    ).toThrow('ACCOUNT_MISSING_PROVIDER_PAYOUT');
  });

  it('does not throw for an onramp row with a null providerPayout', () => {
    expect(() => mapAccountRowToApi(onrampRow, { mask: false })).not.toThrow();
  });

  it('maps an onramp row to details: null, providerPayout: undefined, plus swipeluxCustomerId/kycImportStatus', () => {
    const result = mapAccountRowToApi(onrampRow, { mask: false });
    expect(result.rail.railType).toBe('onramp');
    expect(result.details).toBeNull();
    expect(result.providerPayout).toBeUndefined();
    expect(result.swipeluxCustomerId).toBe('cus_123');
    expect(result.kycImportStatus).toBe('approved');
    expect(result.sofQuestionnaire).toEqual(onrampRow.sofQuestionnaire);
    expect(result.accountHolder?.taxId).toBe('123-45-6789');
    expect(result.sourceOfFundsDocumentPath).toBe('uploads/DOC-sof.pdf');
  });

  it('maps an onramp row before KYC import completes (nulls) without throwing', () => {
    const pending: AccountRowLike = {
      ...onrampRow,
      swipeluxCustomerId: null,
      kycImportStatus: 'pending_import',
    };
    const result = mapAccountRowToApi(pending, { mask: false });
    expect(result.swipeluxCustomerId).toBeNull();
    expect(result.kycImportStatus).toBe('pending_import');
  });

  it('omits capabilities when graphUsdEligible is false', () => {
    const result = mapAccountRowToApi(
      {
        ...onrampRow,
        providerIssuanceStatus: 'pending',
      },
      { mask: false, graphUsdEligible: false }
    );
    expect(result.capabilities).toBeUndefined();
  });

  it('exposes capabilities.usdNamedDeposit for Graph-eligible onramp', () => {
    const ready = mapAccountRowToApi(
      {
        ...onrampRow,
        providerIssuanceStatus: 'active',
        depositDetails: {
          bankName: 'LEAD BANK',
          accountNumber: '213604397161',
          routingNumber: '101019644',
          accountHolderName: 'VIKING PLOOM',
          reference: null,
        },
      },
      { mask: false, graphUsdEligible: true }
    );
    expect(ready.capabilities?.usdNamedDeposit.status).toBe('active');

    const failed = mapAccountRowToApi(
      {
        ...onrampRow,
        providerIssuanceStatus: 'failed',
        providerIssuanceFailureReason: 'GRAPH_PROVISION_STATE_FAILED',
      },
      { mask: false, graphUsdEligible: true }
    );
    expect(failed.capabilities?.usdNamedDeposit).toEqual({
      status: 'failed',
      failureReason: 'PROVISION_STATE_FAILED',
    });

    const notStarted = mapAccountRowToApi(onrampRow, {
      mask: false,
      graphUsdEligible: true,
    });
    expect(notStarted.capabilities?.usdNamedDeposit.status).toBe('not_started');
  });
});
