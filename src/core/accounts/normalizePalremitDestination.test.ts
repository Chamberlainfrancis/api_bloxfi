import { describe, it, expect } from 'vitest';
import { normalizePalremitDestination } from '@/core/accounts/normalizePalremitDestination';

describe('normalizePalremitDestination', () => {
  it('maps swift_code to bank_code and strips wire keys (AED OwlPay legacy)', () => {
    const raw = {
      country: 'AE',
      payout_rail: 'LOCAL_BANK',
      bank_name: 'Wio Bank PJSC',
      swift_code: 'WIOBAEADXXX',
      account_number: 'AE910860000006648238946',
      account_holder_name: 'Matisse Eykelberg',
      beneficiary: {
        name: 'Matisse Eykelberg',
        type: 'individual',
        address: { street: '1 Main', country: 'AE' },
      },
    };
    const out = normalizePalremitDestination(raw);
    expect(out.bank_code).toBe('WIOBAEADXXX');
    expect(out.swift_code).toBeUndefined();
    expect(out.country).toBeUndefined();
    expect(out.payout_rail).toBeUndefined();
    expect(out.account_number).toBe('AE910860000006648238946');
  });

  it('prefers explicit bank_code over swift_code', () => {
    const out = normalizePalremitDestination({
      bank_code: 'CANONICAL',
      swift_code: 'WIREKEY',
      account_number: '123',
      bank_name: 'Bank',
      account_holder_name: 'A',
      beneficiary: { type: 'individual', name: 'A', address: { street: 's', country: 'US' } },
    });
    expect(out.bank_code).toBe('CANONICAL');
    expect(out.swift_code).toBeUndefined();
  });

  it('maps routing_number to bank_code for US ACH legacy', () => {
    const out = normalizePalremitDestination({
      routing_number: '021000021',
      account_number: '123456789',
      bank_name: 'Chase',
      account_holder_name: 'Jane',
      beneficiary: { type: 'individual', name: 'Jane', address: { street: 's', country: 'US' } },
    });
    expect(out.bank_code).toBe('021000021');
    expect(out.routing_number).toBeUndefined();
  });

  it('maps camelCase account fields to snake_case', () => {
    const out = normalizePalremitDestination({
      bankCode: 'TBCBGE22',
      accountNumber: 'GE00TB123',
      bank_name: 'TBC',
      account_holder_name: 'ACME',
      beneficiary: { type: 'business', name: 'ACME', address: { street: 's', country: 'GE' } },
    });
    expect(out.bank_code).toBe('TBCBGE22');
    expect(out.account_number).toBe('GE00TB123');
    expect(out.bankCode).toBeUndefined();
    expect(out.accountNumber).toBeUndefined();
  });

  it('maps extras.swift_code to bank_code when top-level bank_code absent', () => {
    const out = normalizePalremitDestination({
      account_number: '123',
      bank_name: 'HK Bank',
      account_holder_name: 'Co',
      extras: { swift_code: 'HSBCHKHH' },
      beneficiary: { type: 'business', name: 'Co', address: { street: 's', country: 'HK' } },
    });
    expect(out.bank_code).toBe('HSBCHKHH');
  });

  it('normalizes beneficiary address and phone aliases', () => {
    const out = normalizePalremitDestination({
      account_number: '123',
      bank_code: 'ABC',
      bank_name: 'B',
      account_holder_name: 'N',
      beneficiary: {
        type: 'individual',
        name: 'N',
        phone: '+971501234567',
        address: {
          addressLine1: 'Line 1',
          postalCode: '0000',
          stateProvinceRegion: 'DU',
          country: 'AE',
        },
      },
    });
    const ben = out.beneficiary as Record<string, unknown>;
    const addr = ben.address as Record<string, unknown>;
    expect(ben.phone_number).toBe('+971501234567');
    expect(ben.phone).toBeUndefined();
    expect(addr.street).toBe('Line 1');
    expect(addr.postal_code).toBe('0000');
    expect(addr.state_province).toBe('DU');
  });

  it('is idempotent on already-canonical destinations', () => {
    const canonical = {
      account_number: 'AE910860000006648238946',
      bank_code: 'WIOBAEADXXX',
      bank_name: 'Wio Bank PJSC',
      account_holder_name: 'Matisse Eykelberg',
      beneficiary: {
        type: 'individual',
        name: 'Matisse Eykelberg',
        email: 'a@b.com',
        phone_number: '+971501234567',
        address: { street: 'Main', country: 'AE' },
      },
    };
    expect(normalizePalremitDestination(canonical)).toEqual(canonical);
  });
});
