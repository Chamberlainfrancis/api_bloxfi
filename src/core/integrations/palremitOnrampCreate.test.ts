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

/** Fixture user fields + Graph extras that User model does not store today. */
const brianaGraphKycSource = {
  businessInfo: {
    legalName: 'BRIANA PAYMENTS LIMITED',
    tradingName: 'Briana',
    registrationNumber: '14827391',
    entityType: 'LIMITED_COMPANY',
    dateOfIncorporation: '2023-03-15',
    taxIdentificationNumber: 'GB123456789',
    website: 'https://briana.example.test',
    industry: 'moneyTransferRemittance',
    email: 'ops@briana.example.test',
    phone: '+447700900123',
  },
  registeredAddress: {
    addressLine1: '1 Canada Square',
    city: 'London',
    stateProvinceRegion: 'ENG',
    postalCode: 'E14 5AB',
    country: 'GBR',
  },
  legalRepresentative: {
    firstName: 'Adaeze',
    lastName: 'Okeke',
    email: 'adaeze@briana.example.test',
    phone: '+447700900456',
    dateOfBirth: '1990-05-12',
    position: 'Director',
    address: {
      addressLine1: '10 Downing Street',
      city: 'London',
      stateProvinceRegion: 'ENG',
      postalCode: 'SW1A 2AA',
      country: 'GBR',
    },
  },
  documents: [{ type: 'passport', url: 'https://cdn.example.test/briana-ubo-passport.jpg' }],
  background_information: {
    employment_status: 'employed' as const,
    occupation: 'Director',
    primary_purpose: 'business' as const,
    source_of_funds: 'business' as const,
    expected_monthly_inflow: 40_000,
  },
  ubo: {
    id_type: 'passport' as const,
    id_number: 'P123456',
    id_country: 'GB',
  },
  business_id_type: 'registration_certificate',
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

  it('routes Briana USD to Graph FIAT_DEPOSIT_KYC with business kyc_input (no amount extras)', async () => {
    const calls: { path: string; body: unknown }[] = [];
    const request = provisionStub(calls);

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessReference: BRIANA_BUSINESS_REFERENCE,
      businessName: 'BRIANA PAYMENTS LIMITED',
      graphKyc: brianaGraphKycSource,
    });

    expect(result).not.toBeNull();
    expect(calls).toHaveLength(1);
    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_KYC');
    expect(body.allow_provider_failover).toBe(false);
    expect(body.preferred_provider).toBe('graph');
    expect(body.provider_extras).toBeUndefined();
    expect(body).not.toHaveProperty('account_reference');

    const kyc = body.kyc_input as Record<string, unknown>;
    expect(kyc.customer_type).toBe('business');
    expect(kyc.entity_name).toBe('BRIANA PAYMENTS LIMITED');
    expect(kyc.contact_first_name).toBe('Adaeze');
    expect(kyc.contact_last_name).toBe('Okeke');
    expect(kyc.documents).toEqual([
      { type: 'passport', url: 'https://cdn.example.test/briana-ubo-passport.jpg' },
    ]);
    expect(kyc.background_information).toEqual(brianaGraphKycSource.background_information);
    expect((kyc.ubo as Record<string, unknown>).id_type).toBe('passport');
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

  it('fails closed for Briana USD when Graph-required KYC fields are missing', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not provision when Graph KYC is incomplete');
    });

    await expect(
      createOnrampPalremitFiatDeposit(request, {
        ...baseParams,
        currency: 'USD',
        businessReference: BRIANA_BUSINESS_REFERENCE,
        graphKyc: {
          businessInfo: brianaGraphKycSource.businessInfo,
          registeredAddress: brianaGraphKycSource.registeredAddress,
          legalRepresentative: brianaGraphKycSource.legalRepresentative,
          // documents + background intentionally omitted
        },
      })
    ).rejects.toThrow(GraphOnrampKycError);

    try {
      await createOnrampPalremitFiatDeposit(request, {
        ...baseParams,
        currency: 'USD',
        businessReference: BRIANA_BUSINESS_REFERENCE,
        graphKyc: {
          businessInfo: brianaGraphKycSource.businessInfo,
          registeredAddress: brianaGraphKycSource.registeredAddress,
          legalRepresentative: brianaGraphKycSource.legalRepresentative,
        },
      });
      expect.unreachable('expected GraphOnrampKycError');
    } catch (e) {
      expect(e).toBeInstanceOf(GraphOnrampKycError);
      const err = e as GraphOnrampKycError;
      expect(err.missingFields).toEqual(
        expect.arrayContaining(['documents', 'background_information', 'ubo.id_type', 'ubo.id_number'])
      );
      expect(err.message).toMatch(/documents/i);
    }
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
        graphKyc: brianaGraphKycSource,
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

  it('provisions NGN (Kuda) as pooled (LTD. → Palremit-LTD. after merchant prefix)', async () => {
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
            account_holder_name: 'Palremit-LTD.',
          },
        },
      };
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'NGN',
      businessName: 'BloxFi Test Corp',
    });

    const body = calls[0]?.body as Record<string, unknown>;
    expect(body.mode).toBe('FIAT_DEPOSIT_NO_KYC');
    expect(body.provider_extras).toEqual({ account_name: 'LTD.' });
    expect(body.kyc_input).toBeUndefined();
    // Show the real Kuda holder so UI matches NIP name-enquiry.
    expect(result?.depositInfo.beneficiary.name).toBe('Palremit-LTD.');
  });

  it('does not fall back to customer/business name for pooled NGN when holder is synthetic', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => ({
      status: 201,
      data: {
        id: 'acct_ngn_syn',
        state: 'active',
        deposit_instructions: {
          kind: 'fiat_account',
          account_number: '7000746820',
          bank_code: '090267',
          bank_name: 'Kuda Microfinance Bank',
          account_holder_name: 'Palremit-ON-3cb51f7df3a85a4e71b03b50',
        },
      },
    }));

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'NGN',
      businessName: 'BloxFi Test Corp',
    });

    expect(result?.depositInfo.beneficiary.name).toBe('Palremit LTD');
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
    expect(result?.depositInfo.wire).toEqual({
      accountNumber: '9990000103912',
      routingNumber: 'INCEGHAC',
    });
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

  it('does not fall back for NGN when provision fails', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => ({
      status: 500,
      data: { error: 'boom' },
    }));

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'NGN',
    });

    expect(result).toBeNull();
  });
});
