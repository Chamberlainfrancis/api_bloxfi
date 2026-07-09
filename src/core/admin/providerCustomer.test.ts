import { describe, it, expect, vi } from 'vitest';
import {
  putBusinessProviderCustomer,
  listBusinessProviderCustomers,
  deleteBusinessProviderCustomer,
} from '@/core/admin/providerCustomer';

describe('putBusinessProviderCustomer', () => {
  it('PUTs the correct path/body and returns the record on 200', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        tenant_id: 'tnt-1',
        business_reference: 'biz-1',
        provider_name: 'owlpay',
        channel_customer_id: 'cus_AbCdEfGhIjKlMnOpQrStUvWx',
        set_by: 'ops@bloxfi',
        created_at: '2026-07-09T00:00:00.000Z',
        updated_at: '2026-07-09T00:00:00.000Z',
      },
    });

    const res = await putBusinessProviderCustomer(request, {
      tenantId: 'tnt-1',
      businessReference: 'biz-1',
      providerName: 'owlpay',
      channelCustomerId: 'cus_AbCdEfGhIjKlMnOpQrStUvWx',
      setBy: 'ops@bloxfi',
    });

    expect(request).toHaveBeenCalledWith(
      '/v1/admin/tenants/tnt-1/businesses/biz-1/providers/owlpay/customer',
      { method: 'PUT', body: { channel_customer_id: 'cus_AbCdEfGhIjKlMnOpQrStUvWx', set_by: 'ops@bloxfi' } }
    );
    expect(res).toEqual({
      ok: true,
      value: {
        tenant_id: 'tnt-1',
        business_reference: 'biz-1',
        provider_name: 'owlpay',
        channel_customer_id: 'cus_AbCdEfGhIjKlMnOpQrStUvWx',
        set_by: 'ops@bloxfi',
        created_at: '2026-07-09T00:00:00.000Z',
        updated_at: '2026-07-09T00:00:00.000Z',
      },
    });
  });

  it('returns ok:false with the orchestrator status/message on non-200', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 404,
      data: { error: { code: 'not_found', message: 'unknown provider' } },
    });

    const res = await putBusinessProviderCustomer(request, {
      tenantId: 'tnt-1',
      businessReference: 'biz-1',
      providerName: 'no-such-provider',
      channelCustomerId: 'cus_X',
      setBy: 'ops@bloxfi',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(404);
      expect(res.message).toBeTruthy();
    }
  });

  it('URL-encodes business_reference and provider_name', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: {} });
    await putBusinessProviderCustomer(request, {
      tenantId: 'tnt-1',
      businessReference: 'biz with spaces',
      providerName: 'owlpay',
      channelCustomerId: 'cus_X',
      setBy: 'ops',
    });
    expect(request).toHaveBeenCalledWith(
      '/v1/admin/tenants/tnt-1/businesses/biz%20with%20spaces/providers/owlpay/customer',
      expect.anything()
    );
  });
});

describe('listBusinessProviderCustomers', () => {
  it('GETs the list path and returns the parsed result on 200', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        business_reference: 'biz-1',
        providers: [{ provider_name: 'owlpay', channel_customer_id: 'cus_X', updated_at: '2026-07-09T00:00:00.000Z' }],
      },
    });

    const res = await listBusinessProviderCustomers(request, { tenantId: 'tnt-1', businessReference: 'biz-1' });

    expect(request).toHaveBeenCalledWith('/v1/admin/tenants/tnt-1/businesses/biz-1/providers', { method: 'GET' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.providers).toHaveLength(1);
  });

  it('returns ok:false on non-200', async () => {
    const request = vi.fn().mockResolvedValue({ status: 404, data: {} });
    const res = await listBusinessProviderCustomers(request, { tenantId: 'tnt-1', businessReference: 'biz-1' });
    expect(res.ok).toBe(false);
  });
});

describe('deleteBusinessProviderCustomer', () => {
  it('DELETEs with set_by as a query param and returns ok:true on 204', async () => {
    const request = vi.fn().mockResolvedValue({ status: 204, data: undefined });

    const res = await deleteBusinessProviderCustomer(request, {
      tenantId: 'tnt-1',
      businessReference: 'biz-1',
      providerName: 'owlpay',
      setBy: 'ops@bloxfi',
    });

    expect(request).toHaveBeenCalledWith(
      '/v1/admin/tenants/tnt-1/businesses/biz-1/providers/owlpay/customer?set_by=ops%40bloxfi',
      { method: 'DELETE' }
    );
    expect(res).toEqual({ ok: true, value: null });
  });

  it('returns ok:false on non-204', async () => {
    const request = vi.fn().mockResolvedValue({ status: 500, data: { error: { message: 'boom' } } });
    const res = await deleteBusinessProviderCustomer(request, {
      tenantId: 'tnt-1',
      businessReference: 'biz-1',
      providerName: 'owlpay',
      setBy: 'ops',
    });
    expect(res.ok).toBe(false);
  });
});
