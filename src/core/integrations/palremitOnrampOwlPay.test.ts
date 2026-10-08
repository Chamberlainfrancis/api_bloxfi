// metadata.owlpayUsdDeposits: USD onramps pin to OwlPay with failover off, so
// a provisioning failure never lands the deposit on SwipeLux or the house
// customer (the deposit would then not be in the business's name).

import { describe, it, expect, vi } from 'vitest';
import {
  createOnrampPalremitFiatDeposit,
  isOwlPayUsdBusiness,
} from '@/core/integrations/palremitOnramp';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

const baseParams = {
  firstName: 'Franklin',
  lastName: 'Odoemenam',
  email: 'ops@example.com',
  amount: 5000,
  bloxRequestId: 'blox-req-owl-1',
  depositByIso: '2026-10-09T08:00:00.000Z',
  txnRef: 'ON-owlpay-1',
  businessReference: 'user-owlpay-1',
};

function stubRequest(calls: { path: string; body: unknown }[]): PalremitLiquidityRequestFn {
  return vi.fn(async (path, options) => {
    calls.push({ path, body: options?.body });
    if (path === '/v1/provisioned-accounts') {
      return {
        status: 201,
        data: {
          id: 'acct_owl_1',
          state: 'active',
          deposit_instructions: {
            kind: 'fiat_account',
            account_number: '1234567890',
            bank_code: '026073150',
            bank_name: 'Community Federal Savings Bank',
            account_holder_name: 'BOUNDLESS NEXUS LTD',
            reference: null,
          },
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  });
}

describe('isOwlPayUsdBusiness', () => {
  it('is true only for an explicit metadata opt-in', () => {
    expect(isOwlPayUsdBusiness({ owlpayUsdDeposits: true })).toBe(true);
    expect(isOwlPayUsdBusiness({ owlpayUsdDeposits: 'true' })).toBe(false);
    expect(isOwlPayUsdBusiness({})).toBe(false);
    expect(isOwlPayUsdBusiness(null)).toBe(false);
  });
});

describe('USD onramp pinned to OwlPay', () => {
  it('pins owlpay with failover off and drops SwipeLux account hints', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      useOwlPayUsd: true,
      accountReference: 'acc_swx_1',
      contactEmail: 'ops@example.com',
      customerType: 'business',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_NO_KYC');
    expect(body.business_reference).toBe('user-owlpay-1');
    expect(body.preferred_provider).toBe('owlpay');
    expect(body.allow_provider_failover).toBe(false);
    expect(body).not.toHaveProperty('account_reference');
    expect(body.provider_extras).toEqual({ amount: '5000' });
  });

  it('leaves the default USD path untouched without the opt-in', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), { ...baseParams, currency: 'USD' });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('preferred_provider');
    expect(body).not.toHaveProperty('allow_provider_failover');
  });

  it('has no effect on non-USD currencies', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'KES',
      useOwlPayUsd: true,
    });

    const body = calls[0]?.body as Record<string, unknown> | undefined;
    if (body) expect(body).not.toHaveProperty('preferred_provider');
  });
});
