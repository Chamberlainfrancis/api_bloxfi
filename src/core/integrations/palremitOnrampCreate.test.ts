import { describe, it, expect, vi } from 'vitest';
import {
  BRIANA_BUSINESS_REFERENCE,
  createOnrampPalremitFiatDeposit,
} from '@/core/integrations/palremitOnramp';
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

const COASTAL_USD = {
  bankName: 'Coastal Community Bank',
  beneficiary: {
    name: 'Palremit Corporation',
    address: '2309 Melhorn Dr, Alhambra, CA, 91803',
    country: 'US',
  },
  wire: { accountNumber: '875110901746', routingNumber: '125109019' },
  reference: 'ON1234567890',
};

function expectCoastalStatic(
  result: Awaited<ReturnType<typeof createOnrampPalremitFiatDeposit>>
): void {
  expect(result).toMatchObject({
    depositInfo: COASTAL_USD,
    providerRefs: {
      palremitOrchestrator: {
        providerName: 'static_fallback',
        mode: 'STATIC_FALLBACK',
        depositStatus: 'awaiting_manual_credit',
        provisionedAccountId: null,
        staticFallbackReason: 'preferred_static',
      },
    },
  });
}

function noLiquidity(): PalremitLiquidityRequestFn {
  return vi.fn(async () => {
    throw new Error('USD onramps must not call liquidity');
  });
}

describe('createOnrampPalremitFiatDeposit', () => {
  it('gives plain USD the Coastal house account without provisioning (no SwipeLux/OwlPay)', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      accountReference: 'acct-onramp-1',
    });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
    expect(result?.depositInfo.instruction).toContain('wire memo / narration: ON1234567890');
  });

  it('gives Graph USD (Briana) the Coastal house account instead of a named VA', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessReference: BRIANA_BUSINESS_REFERENCE,
      businessName: 'BRIANA PAYMENTS LIMITED',
      useGraphUsd: true,
      graphKycInput: individualGraphKycInput,
      accountReference: 'acct-onramp-1',
    });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
  });

  it('gives Dakota USD the Coastal house account instead of a named VA', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      useDakotaUsd: true,
      graphKycInput: individualGraphKycInput,
      accountReference: 'acct-onramp-1',
    });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
  });

  it('does not require Graph KYC input for Graph USD anymore', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessReference: BRIANA_BUSINESS_REFERENCE,
      useGraphUsd: true,
    });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
  });

  it('ignores an active Account Graph issuance and returns Coastal', async () => {
    const request = noLiquidity();

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
    expectCoastalStatic(result);
    expect(result?.depositInfo.wire?.accountNumber).not.toBe('9992740191426913');
  });

  it('does not fail USD when Account Graph issuance previously failed', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      useGraphUsd: true,
      existingGraphIssuance: {
        providerIssuanceStatus: 'failed',
        provisionedAccountId: 'prov-fail-1',
        depositDetails: null,
        providerIssuanceFailureReason: 'GRAPH_PROVISION_STATE_FAILED',
      },
    });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
  });

  it('shows Palremit Corporation as USD beneficiary even when businessName is provided', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
      businessName: 'BRIANA PAYMENTS LIMITED',
    });

    expect(result?.depositInfo.beneficiary.name).toBe('Palremit Corporation');
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

  it('returns Coastal instructions synchronously for USD (no provision, no polling)', async () => {
    const request = noLiquidity();

    const result = await createOnrampPalremitFiatDeposit(request, { ...baseParams, currency: 'USD' });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
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

  it('prefers static EUR SEPA account without calling provision', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not call liquidity for preferred EUR static');
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'EUR',
    });

    expect(request).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result?.depositInfo.iban).toBe('BG51TRUD40059780011849');
    expect(result?.depositInfo.bic).toBe('TRUDBG21');
    expect(result?.depositInfo.bankName).toBe('RYVYL (EU) EAD');
    expect(result?.depositInfo.beneficiary.name).toBe('IBERBANCO');
    expect(result?.depositInfo.beneficiary.address).toBe(
      '4 Robert Speck Parkway, Mississauga, ON L4Z 1S1, Canada'
    );
    expect(result?.depositInfo.reference).toBe('ON1234567890');
    expect(result?.depositInfo.instruction).toContain('SEPA C2B is not supported');
    const orch = result?.providerRefs.palremitOrchestrator as Record<string, unknown>;
    expect(orch.providerName).toBe('static_fallback');
    expect(orch.staticFallbackReason).toBe('preferred_static');
  });

  it('gives Graph/Bancara businesses the same EUR house SEPA account (no Graph provision)', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      throw new Error('should not call liquidity for EUR even when useGraphUsd');
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'EUR',
      businessReference: BRIANA_BUSINESS_REFERENCE,
      businessName: 'BRIANA PAYMENTS LIMITED',
      useGraphUsd: true,
      graphKycInput: individualGraphKycInput,
    });

    expect(request).not.toHaveBeenCalled();
    expect(result?.depositInfo.iban).toBe('BG51TRUD40059780011849');
    expect(result?.depositInfo.beneficiary.name).toBe('IBERBANCO');
    expect(result?.providerRefs.palremitOrchestrator).toMatchObject({
      providerName: 'static_fallback',
      staticFallbackReason: 'preferred_static',
    });
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

  it('uses Coastal for USD without touching a failing liquidity client', async () => {
    const request: PalremitLiquidityRequestFn = vi.fn(async () => {
      const err = new Error('HTTP 400: Bad Request') as Error & { status: number };
      err.status = 400;
      throw err;
    });

    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      currency: 'USD',
    });

    expect(request).not.toHaveBeenCalled();
    expectCoastalStatic(result);
  });

});
