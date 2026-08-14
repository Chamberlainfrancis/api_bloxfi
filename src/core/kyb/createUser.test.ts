import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/partnerWebhooks', () => ({ schedulePartnerWebhook: vi.fn() }));

import type { CreateUserRequest } from '@/types/user';
import { createBusinessUser } from '@/core/kyb/createUser';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';

function sampleRequest(): CreateUserRequest {
  return {
    type: 'business',
    requestId: '705f1f8b-a080-467c-b683-174eca409928',
    businessInfo: {
      legalName: 'Acme Ltd',
      registrationNumber: '123',
      entityType: 'LIMITED_COMPANY',
      dateOfIncorporation: '2020-01-15',
      taxIdentificationNumber: 'T1',
      industry: 'TECHNOLOGY',
      email: 'admin@acme.com',
      phone: '+440000',
    },
    registeredAddress: {
      addressLine1: '1 St',
      city: 'London',
      postalCode: 'E1',
      country: 'GBR',
    },
    legalRepresentative: {
      firstName: 'A',
      lastName: 'B',
      email: 'rep@acme.com',
      phone: '+440001',
      dateOfBirth: '1980-01-01',
      position: 'Director',
      address: {
        addressLine1: '2 St',
        city: 'London',
        postalCode: 'E2',
        country: 'GBR',
      },
    },
  };
}

describe('createBusinessUser', () => {
  beforeEach(() => {
    vi.mocked(schedulePartnerWebhook).mockClear();
  });

  it('returns created:true when repo inserts', async () => {
    const req = sampleRequest();
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const repo = {
      createUser: vi.fn().mockResolvedValue({
        user: {
          id: 'u1',
          type: 'business',
          status: 'active' as const,
          businessInfo: req.businessInfo,
          kybStatus: 'not_started' as const,
          createdAt,
        },
        created: true,
      }),
    };
    const { response, created } = await createBusinessUser(repo, req);
    expect(created).toBe(true);
    expect(response.id).toBe('u1');
    expect(repo.createUser).toHaveBeenCalledWith(req);
    expect(schedulePartnerWebhook).toHaveBeenCalledWith(
      'user.created',
      expect.objectContaining({ userId: 'u1' })
    );
  });

  it('returns created:false on idempotent replay', async () => {
    const req = sampleRequest();
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const repo = {
      createUser: vi.fn().mockResolvedValue({
        user: {
          id: 'u1',
          type: 'business',
          status: 'active' as const,
          businessInfo: req.businessInfo,
          kybStatus: 'not_started' as const,
          createdAt,
        },
        created: false,
      }),
    };
    const { response, created } = await createBusinessUser(repo, req);
    expect(created).toBe(false);
    expect(response.id).toBe('u1');
    expect(schedulePartnerWebhook).not.toHaveBeenCalled();
  });
});
