import { describe, it, expect, vi } from 'vitest';
import { buildValidatedProviderPayout } from '@/core/accounts/providerPayoutBuild';
import { PayoutDestinationInvalidError } from '@/core/integrations/palremitDestinationCheck';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

const corridor = {
  asset: 'USD',
  country: 'CN',
  destinationType: 'wire',
  beneficiaryType: 'individual' as const,
};

const corridorDetail = {
  corridor: { target_fiat: 'USD', country: 'CN', destination_type: 'wire', beneficiary_type: 'individual' },
  destination_fields: [{ path: 'account_number', type: 'string', required: true, label: 'Account' }],
  destination_template: {},
  amount: { min: null, max: null, currency: 'USD' },
};

const destination = {
  account_number: '6222020200112233445',
  bank_code: 'ICBKCNBJGDG',
  bank_name: 'ICBC',
  account_holder_name: 'Li Wei',
  beneficiary: {
    name: 'Li Wei',
    address: { street: '88 Tianhe Rd', city: 'Guangzhou', state_province: 'Guangdong', postal_code: '510000', country: 'CN' },
  },
};

function requestWith(check: unknown) {
  const calls: { path: string; body?: unknown }[] = [];
  const request = vi.fn(async (path: string, options?: { body?: unknown }) => {
    calls.push({ path, body: options?.body });
    if (path.startsWith('/v1/withdrawals/validate-destination')) return { status: 200, data: check };
    return { status: 200, data: corridorDetail };
  });
  return { request: request as unknown as PalremitLiquidityRequestFn, calls };
}

describe('buildValidatedProviderPayout + Palremit destination check', () => {
  it('rejects the account with Palremit field errors', async () => {
    const { request, calls } = requestWith({
      valid: false,
      errors: [
        {
          field: 'destination.beneficiary.address.state_province',
          code: 'enum',
          message: 'destination.beneficiary.address.state_province must be one of: AH, GD',
          hint: "send the code GD for 'Guangdong'",
        },
      ],
      warnings: [],
    });
    const err = await buildValidatedProviderPayout(request, corridor, destination).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PayoutDestinationInvalidError);
    expect((err as PayoutDestinationInvalidError).message).toContain("send the code GD for 'Guangdong'");
    const check = calls.find((c) => c.path === '/v1/withdrawals/validate-destination');
    expect(check?.body).toMatchObject({ asset: 'USD', country: 'CN', destination_type: 'wire' });
    expect(check?.body).not.toHaveProperty('amount');
  });

  it('does not block on fields the offramp fills in later', async () => {
    const { request } = requestWith({
      valid: false,
      errors: [
        { field: 'destination.extras.transfer_purpose', code: 'required', message: 'x is required' },
        { field: 'destination.beneficiary.dob', code: 'required', message: 'x is required' },
      ],
      warnings: [],
    });
    const payout = await buildValidatedProviderPayout(request, corridor, destination);
    expect(payout.corridor.country).toBe('CN');
  });

  it('saves the account when Palremit cannot answer', async () => {
    const request = vi.fn(async (path: string) => {
      if (path.startsWith('/v1/withdrawals/validate-destination')) {
        throw Object.assign(new Error('HTTP 404'), { status: 404, statusCode: 404, data: {} });
      }
      return { status: 200, data: corridorDetail };
    }) as unknown as PalremitLiquidityRequestFn;
    const payout = await buildValidatedProviderPayout(request, corridor, destination);
    expect(payout.destination).toMatchObject({ account_number: '6222020200112233445' });
  });
});
