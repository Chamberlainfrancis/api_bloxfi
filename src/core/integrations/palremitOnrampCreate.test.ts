import { describe, it, expect, vi } from 'vitest';
import { createOnrampPalremitFiatDeposit } from '@/core/integrations/palremitOnramp';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';

const baseParams = {
  firstName: 'Adaeze',
  lastName: 'Okeke',
  email: 'adaeze@example.test',
  amount: 250,
  bloxRequestId: 'blox-req-1',
  depositByIso: '2026-04-24T08:27:35.726Z',
  txnRef: 'ON1234567890',
  businessReference: 'user-prisma-id-1',
};

describe('createOnrampPalremitFiatDeposit', () => {
  it('selects FIAT_DEPOSIT_NO_KYC and sends business_reference for USD (SwipeLux) — not kyc_input', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const request: PalremitLiquidityRequestFn = vi.fn(async (path, options) => {
      calls.push({ path, body: options?.body });
      if (path === '/v1/provisioned-accounts') {
        return {
          status: 201,
          data: {
            id: 'acct_1',
            state: 'active',
            deposit_instructions: {
              kind: 'fiat_account',
              account_number: '9988776655',
              bank_code: '021000021',
              bank_name: 'Pooled Bank',
              account_holder_name: 'Pooled Account',
              reference: 'SWX-REF-1',
            },
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const result = await createOnrampPalremitFiatDeposit(request, { ...baseParams, currency: 'USD' });

    expect(result).not.toBeNull();
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_NO_KYC');
    expect(body.business_reference).toBe('user-prisma-id-1');
    expect(body.kyc_input).toBeUndefined();
    expect(body.provider_extras).toEqual({ amount: '250' });
    expect(result?.depositInfo.reference).toBe('SWX-REF-1');
    // Real orchestrator holder wins over person/business KYC display.
    expect(result?.depositInfo.beneficiary.name).toBe('Pooled Account');
  });

  it('shows liquidity account_holder_name even when businessName is provided', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async (path) => {
      if (path === '/v1/provisioned-accounts') {
        return {
          status: 201,
          data: {
            id: 'acct_biz',
            state: 'pending',
            deposit_instructions: {
              kind: 'fiat_account',
              account_number: '9988776655',
              bank_code: '021000021',
              bank_name: 'Pooled Bank',
              account_holder_name: 'Veem',
              reference: 'SWX-REF-biz',
            },
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessName: 'BRIANA PAYMENTS LIMITED',
    });

    expect(result?.depositInfo.beneficiary.name).toBe('Veem');
  });

  it('still selects FIAT_DEPOSIT_NO_KYC for NGN (Kuda), unaffected by the USD change', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const request: PalremitLiquidityRequestFn = vi.fn(async (path, options) => {
      calls.push({ path, body: options?.body });
      return {
        status: 201,
        data: {
          id: 'acct_2',
          state: 'active',
          deposit_instructions: {
            kind: 'fiat_account',
            account_number: '7000746820',
            bank_code: '090267',
            bank_name: 'Kuda Microfinance Bank',
            account_holder_name: 'BloxFi Test',
          },
        },
      };
    });

    await createOnrampPalremitFiatDeposit(request, { ...baseParams, currency: 'NGN' });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_NO_KYC');
    expect(body.provider_extras).toBeUndefined();
  });

  it('accepts deposit instructions on a still-pending account without waiting for active (the polling-gate fix)', async () => {
    let getCallCount = 0;
    const request: PalremitLiquidityRequestFn = vi.fn(async (path) => {
      if (path === '/v1/provisioned-accounts') {
        // Fast path: instructions issued synchronously, but state stays
        // pending until real settlement — must not be treated as failure.
        return {
          status: 202,
          data: {
            id: 'acct_3',
            state: 'pending',
            deposit_instructions: {
              kind: 'fiat_account',
              account_number: '111',
              bank_code: '222',
              bank_name: 'Pooled Bank',
              account_holder_name: 'Pooled Account',
              reference: 'SWX-REF-3',
            },
          },
        };
      }
      getCallCount += 1;
      throw new Error('should not need to poll GET when instructions are already present');
    });

    const result = await createOnrampPalremitFiatDeposit(request, { ...baseParams, currency: 'USD' });

    expect(result).not.toBeNull();
    expect(getCallCount).toBe(0);
    expect(result?.depositInfo.reference).toBe('SWX-REF-3');
  });
});
