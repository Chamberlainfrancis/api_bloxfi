import { describe, it, expect, vi } from 'vitest';
import {
  formatDestinationProblems,
  validatePalremitDestination,
} from '@/core/integrations/palremitDestinationCheck';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

function httpError(status: number, data: unknown): Error {
  return Object.assign(new Error(`HTTP ${status}`), { status, statusCode: status, data });
}

const withdrawalBody = {
  client_reference: 'OFF-1',
  business_reference: 'user_1',
  asset: 'USD',
  country: 'CN',
  amount: 1000,
  destination_type: 'wire',
  destination: { account_number: '1', beneficiary: { address: { country: 'CN' } } },
};

describe('validatePalremitDestination', () => {
  it('posts only the destination parts to validate-destination', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { valid: true, errors: [], warnings: [] } });
    const r = await validatePalremitDestination(request as unknown as PalremitLiquidityRequestFn, withdrawalBody);
    expect(r).toEqual({ status: 'valid', warnings: [] });
    expect(request).toHaveBeenCalledWith('/v1/withdrawals/validate-destination', {
      method: 'POST',
      body: {
        asset: 'USD',
        country: 'CN',
        destination_type: 'wire',
        destination: withdrawalBody.destination,
        amount: 1000,
      },
    });
  });

  it('returns the field errors and hints when invalid', async () => {
    const request = vi.fn().mockResolvedValue({
      status: 200,
      data: {
        valid: false,
        errors: [
          {
            path: '/beneficiary_info/beneficiary_address/state_province',
            field: 'destination.beneficiary.address.state_province',
            code: 'enum',
            message: 'destination.beneficiary.address.state_province must be one of: AH, GD',
            hint: "send the code GD for 'Guangdong'",
          },
        ],
        warnings: [{ field: 'destination.beneficiary.address.country', code: 'country_mismatch', message: 'm' }],
      },
    });
    const r = await validatePalremitDestination(request as unknown as PalremitLiquidityRequestFn, withdrawalBody);
    expect(r.status).toBe('invalid');
    if (r.status !== 'invalid') return;
    expect(r.errors[0]).toEqual({
      field: 'destination.beneficiary.address.state_province',
      code: 'enum',
      message: 'destination.beneficiary.address.state_province must be one of: AH, GD',
      hint: "send the code GD for 'Guangdong'",
    });
    expect(r.warnings).toHaveLength(1);
    expect(formatDestinationProblems(r.errors)).toBe(
      "destination.beneficiary.address.state_province must be one of: AH, GD (send the code GD for 'Guangdong')"
    );
  });

  it('treats a 400 validation_failed as invalid', async () => {
    const request = vi.fn().mockRejectedValue(
      httpError(400, { error: 'validation_failed', details: [{ path: 'destination.beneficiary.address.country', code: 'invalid_string' }] })
    );
    const r = await validatePalremitDestination(request as unknown as PalremitLiquidityRequestFn, withdrawalBody);
    expect(r.status).toBe('invalid');
  });

  it.each([
    ['older Palremit without the route', httpError(404, { error: 'not_found' })],
    ['Palremit down', httpError(503, {})],
    ['network error', new Error('ECONNRESET')],
  ])('lets it through when Palremit cannot answer (%s)', async (_label, e) => {
    const request = vi.fn().mockRejectedValue(e);
    const r = await validatePalremitDestination(request as unknown as PalremitLiquidityRequestFn, withdrawalBody);
    expect(r).toEqual({ status: 'unavailable' });
  });

  it('lets it through on an unexpected 200 body', async () => {
    const request = vi.fn().mockResolvedValue({ status: 200, data: { corridors: [] } });
    const r = await validatePalremitDestination(request as unknown as PalremitLiquidityRequestFn, withdrawalBody);
    expect(r).toEqual({ status: 'unavailable' });
  });
});
