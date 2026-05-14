import { describe, it, expect } from 'vitest';
import {
  buildPalremitOfframpFiatWithdrawalBody,
  mapStoredUsdAccountToPalremitGlobalBankDestination,
} from '@/core/integrations/palremitOfframp';

describe('buildPalremitOfframpFiatWithdrawalBody', () => {
  it('builds NGN local bank_account payload', () => {
    const body = buildPalremitOfframpFiatWithdrawalBody({
      payoutKind: 'local_bank_account',
      txnRef: 'OFF-testref',
      destinationAmount: 150000,
      destinationCurrency: 'ngn',
      destinationInformation: {
        account_unique: '0123456789',
        account_name: 'ACME',
        provider_name: 'GTBank',
        provider_code: '058',
        country: 'NG',
      },
    });
    expect(body).toEqual({
      client_reference: 'OFF-testref',
      asset: 'NGN',
      amount: 150000,
      destination_type: 'bank_account',
      destination: {
        bank_code: '058',
        account_number: '0123456789',
      },
    });
  });

  it('builds USD global_bank_account payload', () => {
    const destination = {
      country: 'US',
      payout_rail: 'WIRE',
      account_number: '000111222',
      bank_code: '021000021',
      bank_name: 'Chase',
      account_holder_name: 'ACME LLC',
      beneficiary: {
        name: 'ACME LLC',
        type: 'business',
        address: {
          street: '99 Market St',
          city: 'SF',
          state_province: 'CA',
          postal_code: '94105',
          country: 'US',
        },
      },
      extras: {
        transfer_purpose: 'FAMILY_MAINTENANCE',
        is_self_transfer: false,
      },
    };
    const body = buildPalremitOfframpFiatWithdrawalBody({
      payoutKind: 'global_bank_account',
      txnRef: 'OFF-usd1',
      destinationAmount: 500,
      asset: 'usd',
      destination,
    });
    expect(body).toEqual({
      client_reference: 'OFF-usd1',
      asset: 'USD',
      amount: 500,
      destination_type: 'global_bank_account',
      destination,
    });
  });

  it('returns null when global destination missing account identifiers', () => {
    expect(
      buildPalremitOfframpFiatWithdrawalBody({
        payoutKind: 'global_bank_account',
        txnRef: 'OFF-x',
        destinationAmount: 1,
        asset: 'USD',
        destination: { country: 'US' },
      })
    ).toBeNull();
  });
});

describe('mapStoredUsdAccountToPalremitGlobalBankDestination', () => {
  const meta = { isSelfTransfer: false };

  const regionDetails = {
    currency: 'USD',
    country: 'US',
    accountNumber: '000111222',
    routingNumber: '021000021',
    bankName: 'Chase',
    transferDetails: {
      payoutRail: 'WIRE',
      accountHolderName: 'ACME LLC',
      beneficiary: {
        name: 'ACME LLC',
        type: 'business' as const,
        address: {
          street: '99 Market St',
          city: 'SF',
          stateProvince: 'CA',
          postalCode: '94105',
          country: 'US',
        },
      },
    },
  };

  it('builds Palremit destination from camelCase account + purposeOfPayment + metadata', () => {
    const d = mapStoredUsdAccountToPalremitGlobalBankDestination({
      regionDetails,
      accountHolder: {},
      purposeOfPayment: 'FAMILY_MAINTENANCE',
      metadata: meta,
    });
    expect(d).toEqual({
      country: 'US',
      payout_rail: 'WIRE',
      account_number: '000111222',
      bank_code: '021000021',
      bank_name: 'Chase',
      account_holder_name: 'ACME LLC',
      beneficiary: {
        name: 'ACME LLC',
        type: 'business',
        address: {
          street: '99 Market St',
          city: 'SF',
          state_province: 'CA',
          postal_code: '94105',
          country: 'US',
        },
      },
      extras: { transfer_purpose: 'FAMILY_MAINTENANCE', is_self_transfer: false },
    });
  });

  it('fills beneficiary.type from accountHolder when beneficiary omits type', () => {
    const rd = {
      ...regionDetails,
      transferDetails: {
        ...regionDetails.transferDetails,
        beneficiary: {
          name: 'ACME LLC',
          address: regionDetails.transferDetails.beneficiary.address,
        },
      },
    };
    const d = mapStoredUsdAccountToPalremitGlobalBankDestination({
      regionDetails: rd,
      accountHolder: { type: 'business', name: 'ACME LLC' },
      purposeOfPayment: 'FAMILY_MAINTENANCE',
      metadata: meta,
    });
    expect(d?.beneficiary).toMatchObject({ type: 'business', name: 'ACME LLC' });
  });

  it('merges metadata.extras camelCase over base extras', () => {
    const d = mapStoredUsdAccountToPalremitGlobalBankDestination({
      regionDetails,
      accountHolder: {},
      purposeOfPayment: 'FAMILY_MAINTENANCE',
      metadata: {
        ...meta,
        extras: { transferPurpose: 'INVOICE_PAYMENT', isSelfTransfer: true },
      },
    });
    expect(d?.extras).toEqual({ transfer_purpose: 'INVOICE_PAYMENT', is_self_transfer: true });
  });

  it('returns null when transferDetails missing', () => {
    expect(
      mapStoredUsdAccountToPalremitGlobalBankDestination({
        regionDetails: { ...regionDetails, transferDetails: undefined },
        accountHolder: {},
        purposeOfPayment: 'FAMILY_MAINTENANCE',
        metadata: meta,
      })
    ).toBeNull();
  });

  it('returns null when purposeOfPayment is not UPPER_SNAKE', () => {
    expect(
      mapStoredUsdAccountToPalremitGlobalBankDestination({
        regionDetails,
        accountHolder: {},
        purposeOfPayment: 'family maintenance',
        metadata: meta,
      })
    ).toBeNull();
  });

  it('returns null when metadata missing isSelfTransfer', () => {
    expect(
      mapStoredUsdAccountToPalremitGlobalBankDestination({
        regionDetails,
        accountHolder: {},
        purposeOfPayment: 'FAMILY_MAINTENANCE',
        metadata: {},
      })
    ).toBeNull();
  });
});
