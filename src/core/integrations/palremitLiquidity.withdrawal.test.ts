import { describe, it, expect, vi } from 'vitest';
import {
  createPalremitWithdrawal,
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
