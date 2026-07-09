import { describe, it, expect } from 'vitest';
import { buildWithdrawalFromAccount, isAccountReadyForOfframp } from '@/core/integrations/palremitOfframp';

describe('buildWithdrawalFromAccount', () => {
  const providerPayout = {
    provider: 'palremit' as const,
    schemaVersion: 2 as const,
    corridor: {
      asset: 'USD',
      country: 'GE',
      destinationType: 'wire',
      beneficiaryType: 'business' as const,
    },
    destination: {
      account_number: 'GE00TB123',
      bank_code: 'TBCBGE22',
      bank_name: 'TBC Bank',
      account_holder_name: 'ACME GE',
      beneficiary: {
        type: 'business',
        name: 'ACME GE',
        address: {
          street: '1 Main',
          city: 'Tbilisi',
          state_province: 'TB',
          postal_code: '0108',
          country: 'GE',
        },
      },
      extras: {
        transfer_purpose: 'BUSINESS_PAYMENT',
        is_self_transfer: false,
      },
    },
  };

  it('builds withdrawal from providerPayout', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-corridor1',
      destinationAmount: 100,
      providerPayout,
    });
    expect(body).toMatchObject({
      client_reference: 'OFF-corridor1',
      asset: 'USD',
      country: 'GE',
      destination_type: 'wire',
      amount: 100,
    });
    expect((body?.destination as Record<string, unknown>).account_number).toBe('GE00TB123');
  });

  it('merges purposeOfPayment into extras when missing on account', () => {
    const pp = {
      ...providerPayout,
      destination: {
        account_number: 'GE00TB123',
        bank_code: 'TBCBGE22',
        bank_name: 'TBC',
        account_holder_name: 'ACME',
        beneficiary: providerPayout.destination.beneficiary,
      },
    };
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-x',
      destinationAmount: 50,
      providerPayout: pp,
      purposeOfPayment: 'FAMILY_MAINTENANCE',
      metadata: { isSelfTransfer: true },
    });
    expect((body?.destination as Record<string, unknown>).extras).toEqual({
      transfer_purpose: 'FAMILY_MAINTENANCE',
      is_self_transfer: true,
    });
  });

  it('returns null without providerPayout', () => {
    expect(
      buildWithdrawalFromAccount({
        txnRef: 'OFF-x',
        destinationAmount: 1,
        providerPayout: null,
      })
    ).toBeNull();
  });

  it('includes business_reference when businessReference is provided', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-biz-1',
      destinationAmount: 100,
      providerPayout,
      businessReference: 'biz-channel-user-123',
    });
    expect(body?.business_reference).toBe('biz-channel-user-123');
  });

  it('omits business_reference entirely when not provided', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-no-biz',
      destinationAmount: 100,
      providerPayout,
    });
    expect(body).not.toHaveProperty('business_reference');
  });

  it('omits business_reference when it is an empty/whitespace string', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-blank-biz',
      destinationAmount: 100,
      providerPayout,
      businessReference: '   ',
    });
    expect(body).not.toHaveProperty('business_reference');
  });
});

describe('isAccountReadyForOfframp', () => {
  it('is true when providerPayout is valid', () => {
    expect(
      isAccountReadyForOfframp({
        providerPayout: {
          provider: 'palremit',
          schemaVersion: 2,
          corridor: {
            asset: 'NGN',
            country: 'NG',
            destinationType: 'local_bank',
            beneficiaryType: 'individual',
          },
          destination: { bank_code: '058', account_number: '0123456789' },
        },
      })
    ).toBe(true);
  });

  it('is false when providerPayout missing or invalid', () => {
    expect(isAccountReadyForOfframp({ providerPayout: null })).toBe(false);
    expect(isAccountReadyForOfframp({ providerPayout: { provider: 'palremit', schemaVersion: 1 } })).toBe(
      false
    );
  });
});
