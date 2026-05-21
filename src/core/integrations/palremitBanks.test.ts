import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { resolvePalremitBankAccount } from '@/core/integrations/palremitBanks';
import { logger } from '@/lib/logger';

describe('resolvePalremitBankAccount', () => {
  beforeAll(() => {
    vi.spyOn(logger, 'info').mockImplementation(() => {});
  });
  afterAll(() => {
    vi.mocked(logger.info).mockRestore();
  });

  it('fills bank_code from request when Palremit data omits it', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          bank_name: 'ACCESS BANK',
          account_number: '0123456789',
          account_name: 'JANE DOE',
        },
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '044',
      accountNumber: '0123456789',
    });
    expect(r.bankCode).toBe('044');
  });

  it('fills account_number from request when Palremit data omits it', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          bank_code: '044',
          bank_name: 'ACCESS BANK',
          account_name: 'JANE DOE',
        },
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '044',
      accountNumber: '0123456789',
    });
    expect(r).toEqual({
      bankCode: '044',
      bankName: 'ACCESS BANK',
      accountNumber: '0123456789',
      accountName: 'JANE DOE',
    });
  });

  it('maps Palremit { data: { bank_code, ... } } to BloxFi fields', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          bank_code: '305',
          bank_name: 'OPAY',
          account_number: '9053552140',
          account_name: 'EMMANUEL OLUWATOSIN POPOOLA',
        },
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '305',
      accountNumber: '9053552140',
    });
    expect(r).toEqual({
      bankCode: '305',
      bankName: 'OPAY',
      accountNumber: '9053552140',
      accountName: 'EMMANUEL OLUWATOSIN POPOOLA',
    });
  });

  it('maps nested destination + holder on parent', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          bank_name: 'OPAY',
          destination: { bank_code: '305', account_number: '9053552140' },
          account_holder_name: 'EMMANUEL OLUWATOSIN POPOOLA',
        },
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '305',
      accountNumber: '9053552140',
    });
    expect(r).toEqual({
      bankCode: '305',
      bankName: 'OPAY',
      accountNumber: '9053552140',
      accountName: 'EMMANUEL OLUWATOSIN POPOOLA',
    });
  });

  it('parses entire body as JSON string', async () => {
    const raw =
      '{"data":{"bank_code":"305","bank_name":"OPAY","account_number":"9053552140","account_name":"X"}}';
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: raw as unknown as { data: Record<string, unknown> },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '305',
      accountNumber: '9053552140',
    });
    expect(r.bankCode).toBe('305');
    expect(r.accountName).toBe('X');
  });

  it('maps data array first row', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: [
          {
            bank_code: '044',
            bank_name: 'ACCESS',
            account_number: '0123456789',
            account_name: 'ALICE',
          },
        ],
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '044',
      accountNumber: '0123456789',
    });
    expect(r.accountName).toBe('ALICE');
  });

  it('maps holder_name as account holder', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          bank_code: '044',
          bank_name: 'ACCESS',
          account_number: '0123456789',
          holder_name: 'BOB SMITH',
        },
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '044',
      accountNumber: '0123456789',
    });
    expect(r.accountName).toBe('BOB SMITH');
  });

  it('accepts numeric bank_code and account_number from Palremit', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        data: {
          bank_code: 44,
          bank_name: 'ACCESS BANK',
          account_number: 1234567890,
          account_name: 'JANE DOE',
        },
      },
    });
    const r = await resolvePalremitBankAccount(request, {
      asset: 'NGN',
      bankCode: '044',
      accountNumber: '0123456789',
    });
    expect(r.bankCode).toBe('44');
    expect(r.accountNumber).toBe('1234567890');
  });
});
