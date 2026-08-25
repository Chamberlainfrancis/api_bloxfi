import { describe, it, expect, vi } from 'vitest';
import {
  BRIANA_BUSINESS_REFERENCE,
  createOnrampPalremitFiatDeposit,
} from '@/core/integrations/palremitOnramp';
import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { GraphOnrampKycError } from '@/core/integrations/graphOnrampKyc';

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

/** Pre-built individual Graph kyc_input (from buildGraphIndividualKycInput). */
const individualGraphKycInput = {
  customer_type: 'individual',
  email: 'gilles@kryptonite.agency',
  first_name: 'Gilles',
  last_name: 'Eykelberg',
  phone: '+32479604765',
  date_of_birth: '1989-01-16',
  id_type: 'passport',
  id_number: 'A12345678',
  id_country: 'BE',
  address_line1: '1 Main St',
  address_city: 'Brussels',
  address_state: 'BRU',
  address_postal_code: '1000',
  address_country: 'BEL',
  background_information: {
    employment_status: 'self_employed',
    occupation: 'Self-employed',
    primary_purpose: 'personal',
    source_of_funds: 'business',
    expected_monthly_inflow: 4999,
  },
  documents: [{ type: 'passport', url: 'https://cdn.example.test/passport.png' }],
};

function provisionStub(
  calls: { path: string; body: unknown }[],
  depositOverrides: Record<string, unknown> = {}
): PalremitLiquidityRequestFn {
  return vi.fn(async (path, options) => {
    calls.push({ path, body: options?.body });
    if (path === '/v1/provisioned-accounts') {
      return {
        status: 201,
        data: {
          id: 'acct_briana_graph',
          state: 'pending',
          provider_name: 'graph',
          deposit_instructions: {
            kind: 'fiat_account',
            account_number: '9992740191426913',
            bank_code: '084106768',
            bank_name: 'Oval Bank',
            account_holder_name: 'BRIANA PAYMENTS LIMITED',
            reference: 'GRAPH-BRIANA-1',
            ...depositOverrides,
          },
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  });
}

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
    expect(body.allow_provider_failover).toBeUndefined();
    expect(result?.depositInfo.reference).toBe('SWX-REF-1');
    // Real orchestrator holder wins over person/business KYC display.
    expect(result?.depositInfo.beneficiary.name).toBe('Pooled Account');
  });

  it('routes Graph USD to FIAT_DEPOSIT_KYC with individual kyc_input (no amount extras)', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const request = provisionStub(calls);

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessReference: BRIANA_BUSINESS_REFERENCE,
      businessName: 'BRIANA PAYMENTS LIMITED',
      useGraphUsd: true,
      graphKycInput: individualGraphKycInput,
      accountReference: 'acct-onramp-1',
    });

    expect(result).not.toBeNull();
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_KYC');
    expect(body.allow_provider_failover).toBe(false);
    expect(body.preferred_provider).toBe('graph');
    expect(body.provider_extras).toBeUndefined();
    expect(body.account_reference).toBe('acct-onramp-1');

    const kyc = body.kyc_input as Record<string, unknown>;
    expect(kyc.customer_type).toBe('individual');
    expect(kyc.first_name).toBe('Gilles');
    expect(kyc.last_name).toBe('Eykelberg');
    expect(kyc.documents).toEqual(individualGraphKycInput.documents);
    expect(kyc.background_information).toEqual(individualGraphKycInput.background_information);
    expect(result?.depositInfo.reference).toBe('GRAPH-BRIANA-1');
  });

  it('keeps non-Briana USD on FIAT_DEPOSIT_NO_KYC (SwipeLux) as today', async () => {
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

    await createOnrampPalremitFiatDeposit(request, { ...baseParams, currency: 'USD' });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_NO_KYC');
    expect(body.kyc_input).toBeUndefined();
    expect(body.provider_extras).toEqual({ amount: '250' });
  });

  it('fails closed for Graph USD when graphKycInput is missing', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not provision when Graph KYC is incomplete');
    });

    await expect(
      createOnrampPalremitFiatDeposit(request, {
        ...baseParams,
        currency: 'USD',
        businessReference: BRIANA_BUSINESS_REFERENCE,
        useGraphUsd: true,
      })
    ).rejects.toThrow(GraphOnrampKycError);

    expect(request).not.toHaveBeenCalled();
  });

  it('reuses active Account Graph depositDetails without provisioning again', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not call liquidity when Account issuance is active');
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessReference: BRIANA_BUSINESS_REFERENCE,
      accountReference: 'acc-uuid-1',
      useGraphUsd: true,
      existingGraphIssuance: {
        providerIssuanceStatus: 'active',
        provisionedAccountId: 'prov-reuse-1',
        depositDetails: {
          bankName: 'Oval Bank',
          accountNumber: '9992740191426913',
          routingNumber: '084106768',
          accountHolderName: 'Gilles Eykelberg',
          reference: 'GRAPH-REUSE',
          country: 'US',
        },
      },
    });

    expect(request).not.toHaveBeenCalled();
    expect(result?.depositInfo.wire?.accountNumber).toBe('9992740191426913');
    expect(result?.depositInfo.reference).toBe('GRAPH-REUSE');
    expect(
      (result?.providerRefs.palremitOrchestrator as { reusedAccountIssuance?: boolean })
        ?.reusedAccountIssuance
    ).toBe(true);
  });

  it('fails closed when Account Graph issuance already failed', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not provision after failed Account issuance');
    });

    await expect(
      createOnrampPalremitFiatDeposit(request, {
        ...baseParams,
        currency: 'USD',
        useGraphUsd: true,
        existingGraphIssuance: {
          providerIssuanceStatus: 'failed',
          provisionedAccountId: 'prov-fail-1',
          depositDetails: null,
          providerIssuanceFailureReason: 'GRAPH_PROVISION_STATE_FAILED',
        },
      })
    ).rejects.toThrow('GRAPH_PROVISION_STATE_FAILED');

    expect(request).not.toHaveBeenCalled();
  });

  it('does not static-fallback Briana USD when orchestrator provision fails', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      const err = new Error('HTTP 500') as Error & { status: number };
      err.status = 500;
      throw err;
    });

    await expect(
      createOnrampPalremitFiatDeposit(request, {
        ...baseParams,
        currency: 'USD',
        businessReference: BRIANA_BUSINESS_REFERENCE,
        useGraphUsd: true,
        graphKycInput: individualGraphKycInput,
      })
    ).rejects.toThrow('PALREMIT_FIAT_DEPOSIT_FAILED');
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

  // TEMP: NGN uses preferred Wema static — restore Kuda pooled VA tests when removed.
  it('prefers static NGN Wema account without calling provision', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not call liquidity for preferred NGN static');
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'NGN',
      businessName: 'BloxFi Test Corp',
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      depositInfo: {
        bankName: 'wema',
        beneficiary: { name: 'Palremit limited', country: 'NG' },
        wire: { accountNumber: '7943896852', routingNumber: '035' },
        reference: 'ON1234567890',
      },
      providerRefs: {
        palremitOrchestrator: {
          providerName: 'static_fallback',
          staticFallbackReason: 'preferred_static',
        },
      },
    });
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

  it('prefers static GBP account without calling provision', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not call liquidity for preferred GBP static');
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'GBP',
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.depositInfo.iban).toBe('GB76CLRB04095400000094');
    expect(result?.depositInfo.beneficiary.name).toBe('Tranzy');
    expect(result?.depositInfo.reference).toBe('ON1234567890');
    expect(result?.depositInfo.instruction).toContain(
      'add this exact reference to the payment narration / reference: ON1234567890'
    );
    const orch = result?.providerRefs.palremitOrchestrator as Record<string, unknown>;
    expect(orch.providerName).toBe('static_fallback');
    expect(orch.staticFallbackReason).toBe('preferred_static');
  });

  it('prefers static GHS account without calling provision', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not call liquidity for preferred GHS static');
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'GHS',
    });

    expect(request).not.toHaveBeenCalled();
    expect(result?.depositInfo.bankName).toBe('FBN BANK');
    expect(result?.depositInfo.wire).toEqual({
      accountNumber: '9990000103912',
      routingNumber: '200100',
    });
    expect(result?.depositInfo.sortCode).toBe('200100');
    expect(result?.depositInfo.bic).toBe('INCEGHAC');
    expect(result?.providerRefs.palremitOrchestrator).toMatchObject({
      providerName: 'static_fallback',
      staticFallbackReason: 'preferred_static',
    });
  });

  it('falls back when the HTTP adapter throws on non-2xx for USD (live client behavior)', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      const err = new Error('HTTP 400: Bad Request') as Error & {
        status: number;
        statusCode: number;
        data: unknown;
      };
      err.status = 400;
      err.statusCode = 400;
      err.data = {
        error: 'validation_failed',
        message: 'no KYC schema registered for this (asset, mode)',
      };
      throw err;
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
    });

    expect(result?.depositInfo.wire?.accountNumber).toBe('387199357253');
    expect(result?.providerRefs.palremitOrchestrator).toMatchObject({
      providerName: 'static_fallback',
      staticFallbackReason: 'provision_failed',
    });
  });

});
