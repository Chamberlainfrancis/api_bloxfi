import { describe, it, expect, vi } from 'vitest';
import { createOnrampBeneficiaryWithImport } from '@/core/beneficiaries/createBeneficiary';
import { AppError } from '@/types/errors';
import type { OnrampBeneficiary } from '@/generated/prisma/client';

const now = new Date('2026-07-14T00:00:00.000Z');

function sampleRow(overrides: Partial<OnrampBeneficiary> = {}): OnrampBeneficiary {
  return {
    id: 'ben-1',
    businessUserId: 'user-1',
    status: 'pending_import',
    swipeluxCustomerId: null,
    email: 'a@b.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '+15555550100',
    identitySnapshot: null,
    creationRequestId: '705f1f8b-a080-467c-b683-174eca409928',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

const input = {
  businessUserId: 'user-1',
  requestId: '705f1f8b-a080-467c-b683-174eca409928',
  sumsubShareToken: 'tok_secret',
  email: 'a@b.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '+15555550100',
};

describe('createOnrampBeneficiaryWithImport', () => {
  it('rejects when flag is false', async () => {
    const deps = {
      findUserById: vi.fn().mockResolvedValue({ id: 'user-1', metadata: {} }),
      findByRequestId: vi.fn(),
      createRow: vi.fn(),
      updateStatus: vi.fn(),
      importKyc: vi.fn(),
    };
    await expect(createOnrampBeneficiaryWithImport(deps, input)).rejects.toMatchObject({
      code: 'FORBIDDEN',
      statusCode: 403,
    } satisfies Partial<AppError>);
    expect(deps.importKyc).not.toHaveBeenCalled();
  });

  it('imports and stores cus_* when flag true', async () => {
    const pending = sampleRow();
    const approved = sampleRow({
      status: 'approved',
      swipeluxCustomerId: 'cus_1',
    });
    const deps = {
      findUserById: vi
        .fn()
        .mockResolvedValue({ id: 'user-1', metadata: { swipeluxBeneficiaryKycImport: true } }),
      findByRequestId: vi.fn().mockResolvedValue(null),
      createRow: vi.fn().mockResolvedValue({ row: pending, created: true }),
      updateStatus: vi.fn().mockResolvedValue(approved),
      importKyc: vi.fn().mockResolvedValue({
        ok: true,
        value: { channel_customer_id: 'cus_1', status: 'approved' },
      }),
    };

    const { response, created } = await createOnrampBeneficiaryWithImport(deps, input);
    expect(created).toBe(true);
    expect(response.swipeluxCustomerId).toBe('cus_1');
    expect(response.status).toBe('approved');
    expect(deps.importKyc).toHaveBeenCalledWith(
      expect.objectContaining({
        clientReference: 'ben-1',
        importToken: 'tok_secret',
      })
    );
    expect(deps.createRow.mock.calls[0]?.[0]).not.toHaveProperty('sumsubShareToken');
  });

  it('replays same requestId without calling importKyc again', async () => {
    const existing = sampleRow({ status: 'approved', swipeluxCustomerId: 'cus_1' });
    const deps = {
      findUserById: vi
        .fn()
        .mockResolvedValue({ id: 'user-1', metadata: { swipeluxBeneficiaryKycImport: true } }),
      findByRequestId: vi.fn().mockResolvedValue(existing),
      createRow: vi.fn(),
      updateStatus: vi.fn(),
      importKyc: vi.fn(),
    };

    const { response, created } = await createOnrampBeneficiaryWithImport(deps, input);
    expect(created).toBe(false);
    expect(response.id).toBe('ben-1');
    expect(deps.importKyc).not.toHaveBeenCalled();
    expect(deps.createRow).not.toHaveBeenCalled();
  });

  it('does not pass token into persisted createRow payload', async () => {
    const pending = sampleRow();
    const approved = sampleRow({ status: 'approved', swipeluxCustomerId: 'cus_1' });
    const deps = {
      findUserById: vi
        .fn()
        .mockResolvedValue({ id: 'user-1', metadata: { swipeluxBeneficiaryKycImport: true } }),
      findByRequestId: vi.fn().mockResolvedValue(null),
      createRow: vi.fn().mockResolvedValue({ row: pending, created: true }),
      updateStatus: vi.fn().mockResolvedValue(approved),
      importKyc: vi.fn().mockResolvedValue({
        ok: true,
        value: { channel_customer_id: 'cus_1', status: 'approved' },
      }),
    };

    await createOnrampBeneficiaryWithImport(deps, input);
    const persisted = deps.createRow.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('sumsubShareToken');
    expect(JSON.stringify(persisted)).not.toContain('tok_secret');
  });
});
