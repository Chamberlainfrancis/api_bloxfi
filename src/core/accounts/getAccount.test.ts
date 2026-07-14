import { describe, it, expect, vi } from 'vitest';
import { getAccount } from '@/core/accounts/getAccount';
import type { AccountRowLike } from '@/core/accounts/mapAccountRow';

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
    corridor: { asset: 'AED', country: 'AE', destinationType: 'local_bank', beneficiaryType: 'individual' },
    destination: { account_number: 'AE910860000006648238946', bank_code: 'WIOBAEADXXX' },
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
  accountHolder: { type: 'individual', name: 'Matisse Eykelberg', firstName: 'Matisse', lastName: 'Eykelberg' },
  providerPayout: null,
  swipeluxCustomerId: 'cus_123',
  kycImportStatus: 'approved',
  createdAt: new Date('2026-07-14T00:00:00.000Z'),
  updatedAt: new Date('2026-07-14T00:00:00.000Z'),
};

describe('getAccount', () => {
  it('calls the rail-agnostic findAccountByIdAndUser and returns an offramp account (unchanged)', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue(offrampRow);
    const result = await getAccount({ findAccountByIdAndUser }, 'user-1', 'acc-1');
    expect(findAccountByIdAndUser).toHaveBeenCalledWith('acc-1', 'user-1');
    expect(result?.rail.railType).toBe('offramp');
    expect(result?.providerPayout?.destination.account_number).toBe('AE910860000006648238946');
  });

  it('returns an onramp account without throwing on a missing providerPayout', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue(onrampRow);
    const result = await getAccount({ findAccountByIdAndUser }, 'user-1', 'acc-2');
    expect(result?.rail.railType).toBe('onramp');
    expect(result?.providerPayout).toBeUndefined();
    expect(result?.swipeluxCustomerId).toBe('cus_123');
  });

  it('returns null when the account is not found', async () => {
    const findAccountByIdAndUser = vi.fn().mockResolvedValue(null);
    const result = await getAccount({ findAccountByIdAndUser }, 'user-1', 'missing');
    expect(result).toBeNull();
  });
});
