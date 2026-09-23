import { describe, it, expect, vi } from 'vitest';
import {
  listDakotaKybApplicants,
  attestDakotaKybApplicant,
} from '@/core/admin/dakotaKyb';

describe('listDakotaKybApplicants', () => {
  it('GETs the orchestrator list and returns items', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { items: [{ application_id: 'app_1', name: 'Ada' }] },
    });
    const res = await listDakotaKybApplicants(request);
    expect(request).toHaveBeenCalledWith('/v1/integrations/dakota/applications', { method: 'GET' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.items).toHaveLength(1);
  });
});

describe('attestDakotaKybApplicant', () => {
  it('POSTs accepted_types with an Idempotency-Key', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: { application_id: 'app_1', attested: ['e_sign'], submitted: false, ready: false },
    });
    const res = await attestDakotaKybApplicant(request, {
      applicationId: 'app_1',
      acceptedTypes: ['e_sign'],
      idempotencyKey: 'dakotaattest-app1-1',
    });
    expect(request).toHaveBeenCalledWith('/v1/integrations/dakota/applications/app_1/attestations', {
      method: 'POST',
      body: { accepted_types: ['e_sign'] },
      headers: { 'Idempotency-Key': 'dakotaattest-app1-1' },
    });
    expect(res.ok).toBe(true);
  });
});
