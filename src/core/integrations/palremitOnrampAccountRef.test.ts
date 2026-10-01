// account_reference / contact_email / customer_type on the onramp provision
// body. USD and NGN use house accounts, so neither sends a provision body.

import { describe, it, expect, vi } from 'vitest';
import { createOnrampPalremitFiatDeposit } from '@/core/integrations/palremitOnramp';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

/** Non-Briana business — SwipeLux account_reference path (Briana USD is Graph KYC). */
const baseParams = {
  firstName: 'Jonathan',
  lastName: 'Marquis',
  email: 'jehinc26@gmail.com',
  amount: 250,
  bloxRequestId: 'blox-req-1',
  depositByIso: '2026-08-24T08:27:35.726Z',
  txnRef: 'ON1234567890',
  businessReference: 'user-swipelux-account-ref-1',
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
  // USD now uses the Coastal house account — no provision body is sent, so
  // account_reference / contact_email / customer_type never reach liquidity.
  it('does not provision USD even when account_reference, contact_email and customer_type are set', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const result = await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      accountReference: 'acc_swx_1',
      contactEmail: 'jehinc26@gmail.com',
      customerType: 'individual',
    });

    expect(calls).toHaveLength(0);
    expect(result?.depositInfo.wire?.accountNumber).toBe('875110901746');
    expect(result?.depositInfo.reference).toBe('ON1234567890');
  });

  it('does not provision USD when no account_reference was inferred', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const result = await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
    });

    expect(calls).toHaveLength(0);
    expect(result?.depositInfo.bankName).toBe('Coastal Community Bank');
  });

  it('does not provision USD with contact_email but no account_reference', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const result = await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      contactEmail: 'jehinc26@gmail.com',
      customerType: 'individual',
    });

    expect(calls).toHaveLength(0);
    expect(result?.depositInfo.wire?.routingNumber).toBe('125109019');
  });

  it('does not provision USD with account_reference but no contact email', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const result = await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'USD',
      accountReference: 'acc_swx_1',
      customerType: 'individual',
    });

    expect(calls).toHaveLength(0);
    expect(result?.depositInfo.beneficiary.name).toBe('Palremit Corporation');
  });

  // TEMP: NGN preferred Wema static skips provision (no account_reference path).
  it('skips provision for preferred static NGN', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const result = await createOnrampPalremitFiatDeposit(stubRequest(calls), {
      ...baseParams,
      currency: 'NGN',
      accountReference: 'acc_swx_1',
      contactEmail: 'jehinc26@gmail.com',
    });

    expect(calls).toHaveLength(0);
    expect(result?.depositInfo.wire?.accountNumber).toBe('7943896852');
  });
});
