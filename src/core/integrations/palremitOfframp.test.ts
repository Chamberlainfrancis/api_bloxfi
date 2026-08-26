import { describe, it, expect } from 'vitest';
import {
  buildWithdrawalFromAccount,
  isAccountReadyForOfframp,
  mergeSourceAmountCapIntoProviderRefs,
} from '@/core/integrations/palremitOfframp';

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

  it('copies sourceAmountCap onto source_amount_cap', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-cap',
      destinationAmount: 100,
      providerPayout,
      sourceAmountCap: '32138.11000000',
    });
    expect(body?.source_amount_cap).toBe('32138.110000');
  });

  it('truncates an 8-dp sendNet cap to 6 fractional digits (Palremit POST /v1/withdrawals)', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-f1d46de782ca751e13743b7b',
      destinationAmount: 14965.55,
      providerPayout,
      sourceAmountCap: '17494.82858461',
    });
    expect(body?.source_amount_cap).toBe('17494.828584');
  });

  it('omits source_amount_cap when sendNet is missing', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-cap',
      destinationAmount: 100,
      providerPayout,
    });
    expect(body).not.toHaveProperty('source_amount_cap');
  });

  it('persists sourceAmountCap truncated to 6 fractional digits', () => {
    const refs = mergeSourceAmountCapIntoProviderRefs({}, '5815.84236280');
    expect(
      (refs.palremitOrchestrator as { sourceAmountCap: string }).sourceAmountCap
    ).toBe('5815.842362');
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

  it('normalizes legacy swift_code to bank_code on payout', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-aed-legacy',
      destinationAmount: 100,
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
          swift_code: 'WIOBAEADXXX',
          account_number: 'AE910860000006648238946',
          bank_name: 'Wio Bank PJSC',
          account_holder_name: 'Matisse Eykelberg',
          beneficiary: {
            type: 'individual',
            name: 'Matisse Eykelberg',
            address: { street: 'Main', country: 'AE' },
          },
        },
      },
    });
    const dest = body?.destination as Record<string, unknown>;
    expect(dest.bank_code).toBe('WIOBAEADXXX');
    expect(dest.swift_code).toBeUndefined();
  });

  it('backfills beneficiary.email from accountHolderEmail when missing on destination', () => {
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-email',
      destinationAmount: 100,
      providerPayout,
      accountHolderEmail: 'ops@example.com',
    });
    const ben = (body?.destination as { beneficiary: { email?: string } }).beneficiary;
    expect(ben.email).toBe('ops@example.com');
  });

  it('does not overwrite an existing beneficiary.email', () => {
    const pp = {
      ...providerPayout,
      destination: {
        ...providerPayout.destination,
        beneficiary: { ...providerPayout.destination.beneficiary, email: 'keep@example.com' },
      },
    };
    const body = buildWithdrawalFromAccount({
      txnRef: 'OFF-email-keep',
      destinationAmount: 100,
      providerPayout: pp,
      accountHolderEmail: 'ops@example.com',
    });
    const ben = (body?.destination as { beneficiary: { email?: string } }).beneficiary;
    expect(ben.email).toBe('keep@example.com');
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
