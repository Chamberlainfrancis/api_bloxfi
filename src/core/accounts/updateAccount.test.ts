import { describe, it, expect, vi } from 'vitest';
import { updateAccount } from '@/core/accounts/updateAccount';

const corridor = {
  asset: 'AED',
  country: 'AE',
  destinationType: 'local_bank',
  beneficiaryType: 'individual' as const,
};

const storedPayout = {
  provider: 'palremit',
  schemaVersion: 2,
  corridor,
  destination: {
    account_number: 'AE910860000006648238946',
    swift_code: 'WIOBAEADXXX',
    bank_name: 'Wio Bank PJSC',
    account_holder_name: 'Matisse Eykelberg',
    beneficiary: {
      type: 'individual',
      name: 'Matisse Eykelberg',
      address: { street: 'Main', country: 'AE', city: 'Dubai' },
    },
  },
};

const accountRow = {
  id: 'acc-1',
  userId: 'user-1',
  railType: 'offramp',
  currency: 'aed',
  paymentRail: 'local_bank',
  accountType: 'primary',
  accountHolder: { type: 'individual', name: 'Matisse Eykelberg' },
  providerPayout: storedPayout,
  createdAt: new Date('2026-05-22T00:00:00.000Z'),
  updatedAt: new Date('2026-05-22T00:00:00.000Z'),
};

describe('updateAccount', () => {
  it('merges patch, re-validates against live corridor, and persists', async () => {
    const liquidityRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        corridor: {
          target_fiat: 'AED',
          country: 'AE',
          destination_type: 'local_bank',
          beneficiary_type: 'individual',
        },
        destination_fields: [
          { path: 'account_number', type: 'string', required: true, label: 'IBAN' },
          { path: 'bank_code', type: 'string', required: true, label: 'BIC' },
          { path: 'beneficiary.email', type: 'string', required: true, label: 'Email' },
          { path: 'beneficiary.phone_number', type: 'string', required: true, label: 'Phone' },
        ],
        destination_template: {},
        amount: { min: null, max: null, currency: 'AED' },
      },
    });

    const updateAccountProviderPayout = vi.fn().mockImplementation(
      async (_id: string, _userId: string, providerPayout: object) => ({
        ...accountRow,
        providerPayout,
        updatedAt: new Date('2026-07-09T00:00:00.000Z'),
      })
    );

    const result = await updateAccount(
      {
        findOfframpAccountByIdAndUser: vi.fn().mockResolvedValue(accountRow),
        updateAccountProviderPayout,
      },
      'user-1',
      'acc-1',
      {
        destination: {
          beneficiary: {
            email: 'matisse@example.com',
            phone_number: '+971501234567',
          },
        },
      },
      { palremitLiquidityRequest: liquidityRequest }
    );

    expect(result?.id).toBe('acc-1');
    expect(result?.providerPayout.destination.beneficiary).toMatchObject({
      email: 'matisse@example.com',
      phone_number: '+971501234567',
    });
    expect(result?.providerPayout.destination.bank_code).toBe('WIOBAEADXXX');
    expect((result?.providerPayout.destination as Record<string, unknown>).swift_code).toBeUndefined();
    expect(updateAccountProviderPayout).toHaveBeenCalledOnce();
    expect(result?.providerPayout.requirementsSnapshot?.fetchedAt).toBeDefined();
  });

  it('returns null when account not found', async () => {
    const result = await updateAccount(
      {
        findOfframpAccountByIdAndUser: vi.fn().mockResolvedValue(null),
        updateAccountProviderPayout: vi.fn(),
      },
      'user-1',
      'missing',
      { destination: {} },
      { palremitLiquidityRequest: vi.fn() }
    );
    expect(result).toBeNull();
  });

  it('rejects when merged destination still fails corridor validation', async () => {
    const liquidityRequest = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        corridor: {
          target_fiat: 'AED',
          country: 'AE',
          destination_type: 'local_bank',
          beneficiary_type: 'individual',
        },
        destination_fields: [
          { path: 'beneficiary.email', type: 'string', required: true, label: 'Email' },
        ],
        destination_template: {},
        amount: { min: null, max: null, currency: 'AED' },
      },
    });

    await expect(
      updateAccount(
        {
          findOfframpAccountByIdAndUser: vi.fn().mockResolvedValue(accountRow),
          updateAccountProviderPayout: vi.fn(),
        },
        'user-1',
        'acc-1',
        { destination: {} },
        { palremitLiquidityRequest: liquidityRequest }
      )
    ).rejects.toThrow(/INVALID_ACCOUNT:.*beneficiary\.email/);
  });
});
