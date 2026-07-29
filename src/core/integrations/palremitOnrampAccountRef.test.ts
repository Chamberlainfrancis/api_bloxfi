// account_reference / contact_email / customer_type on the USD onramp
// provision body. These three travel together — sending an account_reference
// the orchestrator cannot resolve turns a working onramp into a permanent
// refusal, so the omission cases matter as much as the happy path.

import { describe, it, expect, vi } from 'vitest';
import { createOnrampPalremitFiatDeposit } from '@/core/integrations/palremitOnramp';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

const baseParams = {
  firstName: 'Jonathan',
  lastName: 'Marquis',
  email: 'jehinc26@gmail.com',
  amount: 250,
  bloxRequestId: 'blox-req-1',
  depositByIso: '2026-08-24T08:27:35.726Z',
  txnRef: 'ON1234567890',
  businessReference: '9eea8cbd-e545-4d15-85cd-90690ede4b0c',
};

function stubRequest(calls: { path: string; body: unknown }[]): PalremitLiquidityRequestFn {
  return vi.fn(async (path, options) => {
    calls.push({ path, body: options?.body });
    if (path === '/v1/provisioned-accounts') {
      return {
        status: 201,
        data: {
          id: 'acct_1',
          state: 'active',
          deposit_instructions: {
            kind: 'fiat_account',
            account_number: '31254097',
            bank_code: '021000089',
            bank_name: 'Citibank, N.A.',
            account_holder_name: 'Veem',
            reference: 'SWX-REF-1',
          },
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  });
}

describe('USD onramp account_reference', () => {
  it('sends account_reference plus contact_email and customer_type when inferred', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      accountReference: 'acc_briana_1',
      contactEmail: 'jehinc26@gmail.com',
      customerType: 'individual',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.account_reference).toBe('acc_briana_1');
    expect(body.business_reference).toBe('9eea8cbd-e545-4d15-85cd-90690ede4b0c');
    expect(body.provider_extras).toMatchObject({
      amount: '250',
      contact_email: 'jehinc26@gmail.com',
      customer_type: 'individual',
    });
  });

  // Inference inconclusive → the orchestrator must stay on its per-business
  // path, which is exactly today's behaviour.
  it('omits account_reference entirely when none was inferred', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), { ...baseParams, currency: 'USD' });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('account_reference');
    expect(body.provider_extras).toEqual({ amount: '250' });
  });

  // Without an account_reference the orchestrator has nothing to key a
  // mapping on, so the SwipeLux hints would be dead weight on the wire.
  it('does not send contact_email or customer_type without an account_reference', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      contactEmail: 'jehinc26@gmail.com',
      customerType: 'individual',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.provider_extras).toEqual({ amount: '250' });
  });

  it('still sends account_reference when the account has no contact email', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      accountReference: 'acc_briana_1',
      customerType: 'individual',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.account_reference).toBe('acc_briana_1');
    expect(body.provider_extras).not.toHaveProperty('contact_email');
  });

  // NGN routes to Kuda, which has no per-account customer concept.
  it('leaves the NGN body untouched', async () => {
    const calls: { path: string; body: unknown }[] = [];
    await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'NGN',
      accountReference: 'acc_briana_1',
      contactEmail: 'jehinc26@gmail.com',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body).not.toHaveProperty('account_reference');
    expect(body.provider_extras).not.toHaveProperty('contact_email');
  });
});
