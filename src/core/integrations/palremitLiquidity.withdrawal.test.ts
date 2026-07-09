import { describe, it, expect, vi } from 'vitest';
import {
  createPalremitWithdrawal,
  createPalremitWithdrawalDetailed,
  formatPalremitWithdrawalError,
  getPalremitWithdrawalByClientReference,
} from '@/core/integrations/palremitLiquidity';

describe('createPalremitWithdrawal', () => {
  it('parses flat 202 withdrawal body from Palremit', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 202,
      data: {
        id: 'wd-flat-1',
        client_reference: 'OFF-aaaaaaaaaaaaaaaaaaaaaaaa-FEE',
        state: 'pending',
        outcome: 'fresh',
      },
    });

    const res = await createPalremitWithdrawal(
      request,
      { client_reference: 'OFF-aaaaaaaaaaaaaaaaaaaaaaaa-FEE' },
      'idem-1'
    );

    expect(res).toEqual({
      id: 'wd-flat-1',
      client_reference: 'OFF-aaaaaaaaaaaaaaaaaaaaaaaa-FEE',
      state: 'pending',
      raw: {
        id: 'wd-flat-1',
        client_reference: 'OFF-aaaaaaaaaaaaaaaaaaaaaaaa-FEE',
        state: 'pending',
        outcome: 'fresh',
      },
    });
  });

  it('parses legacy wrapped withdrawal body', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 202,
      data: {
        data: {
          id: 'wd-wrap-1',
          client_reference: 'OFF-bbbbbbbbbbbbbbbbbbbbbbbb-FEE',
          state: 'processing',
        },
      },
    });

    const res = await createPalremitWithdrawal(request, {}, 'idem-2');
    expect(res?.id).toBe('wd-wrap-1');
    expect(res?.client_reference).toBe('OFF-bbbbbbbbbbbbbbbbbbbbbbbb-FEE');
  });

  it('returns null on non-202 via createPalremitWithdrawal', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 403,
      data: {
        error: 'provider_customer_not_onboarded',
        message: 'business has not been onboarded with the required provider',
      },
    });
    const res = await createPalremitWithdrawal(request, {}, 'idem-3');
    expect(res).toBeNull();
  });
});

describe('createPalremitWithdrawalDetailed', () => {
  it('returns structured failure on non-202', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 403,
      data: {
        error: 'provider_customer_not_onboarded',
        message: 'business has not been onboarded with the required provider',
      },
    });
    const res = await createPalremitWithdrawalDetailed(request, {}, 'idem-4');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain('provider_customer_not_onboarded');
      expect(res.httpStatus).toBe(403);
    }
  });

  it('returns structured failure when httpRequest throws on 4xx', async () => {
    const err = new Error('HTTP 400: Bad Request') as Error & { status: number; statusCode: number; data: unknown };
    err.status = 400;
    err.statusCode = 400;
    err.data = {
      error: 'payout_requirements_invalid',
      message: 'destination.fields failed validation',
    };
    const request = vi.fn().mockRejectedValue(err);
    const res = await createPalremitWithdrawalDetailed(request, {}, 'idem-5');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.message).toContain('destination.fields failed validation');
      expect(res.httpStatus).toBe(400);
    }
  });
});

describe('formatPalremitWithdrawalError', () => {
  it('combines error code and message when both differ', () => {
    expect(
      formatPalremitWithdrawalError(
        { error: 'provider_customer_not_onboarded', message: 'business has not been onboarded' },
        403
      )
    ).toBe('provider_customer_not_onboarded: business has not been onboarded');
  });
});

describe('getPalremitWithdrawalByClientReference', () => {
  it('returns parsed withdrawal on 200', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        id: 'wd-live-1',
        client_reference: 'OFF-cccccccccccccccccccccccc-FEE',
        state: 'successful',
        settlement_reference: '0xabc',
      },
    });

    const res = await getPalremitWithdrawalByClientReference(
      request,
      'OFF-cccccccccccccccccccccccc-FEE'
    );
    expect(res?.id).toBe('wd-live-1');
    expect(res?.state).toBe('successful');
    expect(request).toHaveBeenCalledWith(
      '/v1/withdrawals/by-client-ref/OFF-cccccccccccccccccccccccc-FEE',
      { method: 'GET' }
    );
  });
});
