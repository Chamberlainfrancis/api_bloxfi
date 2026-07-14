import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { listBusinesses, searchBusinesses, patchUserMetadata } from '@/api/admin/controllers';
import { listUsers, searchUsers, mergeUserMetadata } from '@/db/repositories/user.repo';
import * as providerCustomer from '@/core/admin/providerCustomer';

vi.mock('@/config', () => ({
  env: {
    PALREMIT_LIQUIDITY_TENANT_ID: 'tenant_test',
    DASHBOARD_MARK_SECRET: 'pr2026',
  },
}));

vi.mock('@/services/palremitAdapters', () => ({
  createPalremitLiquidityAdapter: vi.fn(() => vi.fn()),
}));

vi.mock('@/db/repositories/user.repo', () => {
  return {
    listUsers: vi.fn(),
    searchUsers: vi.fn(),
    mergeUserMetadata: vi.fn(),
  };
});

vi.mock('@/core/admin/providerCustomer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/admin/providerCustomer')>();
  return {
    ...actual,
    resolveDashboardProviderStatus: vi.fn(),
  };
});

function buildResponse(): Response {
  const res = {
    status: vi.fn(),
    json: vi.fn(),
  } as unknown as Response;
  (res.status as unknown as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

describe('searchBusinesses', () => {
  const mockedSearchUsers = vi.mocked(searchUsers);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('searches businesses by query and returns lightweight rows', async () => {
    mockedSearchUsers.mockResolvedValue([
      {
        id: 'user_123',
        legalName: 'Acme Ltd',
        email: 'ops@acme.test',
        kybStatus: 'approved',
        createdAt: '2026-01-01T00:00:00.000Z',
        lastTransactedAt: null,
      },
    ]);
    const req = { query: { q: 'acme' } } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await searchBusinesses(req, res, next);

    expect(mockedSearchUsers).toHaveBeenCalledWith('acme', 10);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        items: [
          {
            id: 'user_123',
            legalName: 'Acme Ltd',
            email: 'ops@acme.test',
            kybStatus: 'approved',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastTransactedAt: null,
          },
        ],
      },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('listBusinesses', () => {
  const mockedListUsers = vi.mocked(listUsers);
  const mockedResolveStatus = vi.mocked(providerCustomer.resolveDashboardProviderStatus);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists businesses with provider status and pagination cursor', async () => {
    const nextCursor = new Date('2026-01-15T12:00:00.000Z');
    mockedListUsers.mockResolvedValue({
      users: [
        {
          id: 'user_123',
          legalName: 'Acme Ltd',
          email: 'ops@acme.test',
          kybStatus: 'approved',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastTransactedAt: '2026-06-15T10:00:00.000Z',
        },
      ],
      nextCursor,
    });
    mockedResolveStatus.mockResolvedValue({ owlpay: 'active', yativo: 'inactive' });
    const req = { query: {} } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await listBusinesses(req, res, next);

    expect(mockedListUsers).toHaveBeenCalledWith({ q: undefined, limit: undefined, createdBefore: undefined });
    expect(mockedResolveStatus).toHaveBeenCalledWith(expect.any(Function), {
      tenantId: 'tenant_test',
      businessReference: 'user_123',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        items: [
          {
            id: 'user_123',
            legalName: 'Acme Ltd',
            email: 'ops@acme.test',
            kybStatus: 'approved',
            createdAt: '2026-01-01T00:00:00.000Z',
            lastTransactedAt: '2026-06-15T10:00:00.000Z',
            providers: { owlpay: 'active', yativo: 'inactive' },
          },
        ],
        nextCursor: nextCursor.toISOString(),
      },
    });
    expect(next).not.toHaveBeenCalled();
  });
});

describe('patchUserMetadata', () => {
  const mockedMergeUserMetadata = vi.mocked(mergeUserMetadata);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('merges swipeluxBeneficiaryKycImport into metadata when passcode is correct', async () => {
    mockedMergeUserMetadata.mockResolvedValue(undefined);
    const req = {
      params: { userId: 'user_123' },
      body: { swipeluxBeneficiaryKycImport: true, secret: 'pr2026' },
      headers: {},
    } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await patchUserMetadata(req, res, next);

    expect(mockedMergeUserMetadata).toHaveBeenCalledWith('user_123', { swipeluxBeneficiaryKycImport: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: { ok: true },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts passcode via x-dashboard-secret header', async () => {
    mockedMergeUserMetadata.mockResolvedValue(undefined);
    const req = {
      params: { userId: 'user_456' },
      body: { swipeluxBeneficiaryKycImport: false },
      headers: { 'x-dashboard-secret': 'pr2026' },
    } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await patchUserMetadata(req, res, next);

    expect(mockedMergeUserMetadata).toHaveBeenCalledWith('user_456', { swipeluxBeneficiaryKycImport: false });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('returns 401 when passcode is incorrect', async () => {
    const req = {
      params: { userId: 'user_123' },
      body: { swipeluxBeneficiaryKycImport: true, secret: 'wrong_secret' },
      headers: {},
    } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await patchUserMetadata(req, res, next);

    expect(mockedMergeUserMetadata).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Incorrect passcode', statusCode: 401 }));
  });

  it('returns 401 when passcode is missing', async () => {
    const req = {
      params: { userId: 'user_123' },
      body: { swipeluxBeneficiaryKycImport: true },
      headers: {},
    } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await patchUserMetadata(req, res, next);

    expect(mockedMergeUserMetadata).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Incorrect passcode', statusCode: 401 }));
  });

  it('coerces non-boolean swipeluxBeneficiaryKycImport to boolean (non-true values become false)', async () => {
    mockedMergeUserMetadata.mockResolvedValue(undefined);
    const req = {
      params: { userId: 'user_123' },
      body: { swipeluxBeneficiaryKycImport: 'true', secret: 'pr2026' },
      headers: {},
    } as unknown as Request;
    const res = buildResponse();
    const next = vi.fn() as unknown as NextFunction;

    await patchUserMetadata(req, res, next);

    // String 'true' is not === true, so it becomes false
    expect(mockedMergeUserMetadata).toHaveBeenCalledWith('user_123', { swipeluxBeneficiaryKycImport: false });
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
