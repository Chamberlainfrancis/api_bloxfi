import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { postDakotaKybAttestations } from '@/api/admin/controllers';
import { attestDakotaKybApplicant } from '@/core/admin/dakotaKyb';

vi.mock('@/config', () => ({
  env: {
    PALREMIT_LIQUIDITY_TENANT_ID: 'tenant_test',
    DASHBOARD_MARK_SECRET: 'pr2026',
  },
}));

vi.mock('@/services/palremitAdapters', () => ({
  createPalremitLiquidityAdapter: vi.fn(() => vi.fn()),
}));

vi.mock('@/db/repositories/user.repo', () => ({
  listUsers: vi.fn(),
  searchUsers: vi.fn(),
  mergeUserMetadata: vi.fn(),
}));

vi.mock('@/core/admin/dashboard', () => ({}));

vi.mock('@/core/admin/providerCustomer', () => ({
  resolveDashboardProviderStatus: vi.fn(),
  listBusinessProviderCustomers: vi.fn(),
}));

vi.mock('@/core/admin/dakotaKyb', () => ({
  listDakotaKybApplicants: vi.fn(),
  getDakotaKybApplicant: vi.fn(),
  attestDakotaKybApplicant: vi.fn(),
}));

function mockRes(): Response {
  return { status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() } as unknown as Response;
}

describe('postDakotaKybAttestations', () => {
  beforeEach(() => {
    vi.mocked(attestDakotaKybApplicant).mockReset();
  });

  it('returns 401 when passcode is missing', async () => {
    const req = {
      params: { applicationId: 'app_1' },
      headers: {},
      body: { accepted_types: ['e_sign'] },
    } as unknown as Request;
    const next = vi.fn() as NextFunction;
    await postDakotaKybAttestations(req, mockRes(), next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Incorrect passcode', statusCode: 401 }),
    );
  });

  it('proxies accepted types when passcode is correct', async () => {
    vi.mocked(attestDakotaKybApplicant).mockResolvedValue({
      ok: true,
      value: {
        application_id: 'app_1',
        attested: ['e_sign'],
        submitted: false,
        ready: false,
        status_message: 'Waiting',
        missing_attestations: [],
        missing_fields: ['name'],
        missing_documents: [],
      },
    });
    const req = {
      params: { applicationId: 'app_1' },
      headers: { 'x-dashboard-secret': 'pr2026' },
      body: { accepted_types: ['e_sign', 'privacy_policy'] },
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await postDakotaKybAttestations(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(attestDakotaKybApplicant).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        applicationId: 'app_1',
        acceptedTypes: ['e_sign', 'privacy_policy'],
      }),
    );
  });
});
