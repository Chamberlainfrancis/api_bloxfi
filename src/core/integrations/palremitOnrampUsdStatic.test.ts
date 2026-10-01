// USD onramps use the Coastal Community Bank house account for every
// business (including Graph/Dakota named-USD ones). No provider VA is issued.

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
  currency: 'USD',
  amount: 5000,
  bloxRequestId: 'blox-req-1',
  depositByIso: '2026-10-02T08:27:35.726Z',
  txnRef: 'ON-635d8fecfbc6926c9333ad98',
  businessReference: 'user-prisma-id-1',
};

const coastal = {
  depositInfo: {
    bankName: 'Coastal Community Bank',
    beneficiary: {
      name: 'Palremit Corporation',
      address: '2309 Melhorn Dr, Alhambra, CA, 91803',
      country: 'US',
    },
    wire: { accountNumber: '875110901746', routingNumber: '125109019' },
    reference: 'ON-635d8fecfbc6926c9333ad98',
  },
  providerRefs: {
    palremitOrchestrator: {
      providerName: 'static_fallback',
      depositStatus: 'awaiting_manual_credit',
      provisionedAccountId: null,
      staticFallbackReason: 'preferred_static',
    },
  },
};

function noLiquidity(): PalremitLiquidityRequestFn {
  return vi.fn(async () => {
    throw new Error('USD must not call liquidity');
  });
}

describe('USD onramp → Coastal static account', () => {
  it('returns Coastal for a plain USD onramp without provisioning', async () => {
    const request = noLiquidity();
    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      accountReference: 'acc_1',
      contactEmail: 'adaeze@example.test',
      customerType: 'individual',
    });
    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject(coastal);
    expect(result?.depositInfo.instruction).toContain(
      'wire memo / narration: ON-635d8fecfbc6926c9333ad98'
    );
  });

  it('returns Coastal for Graph USD businesses', async () => {
    const request = noLiquidity();
    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      businessReference: BRIANA_BUSINESS_REFERENCE,
      useGraphUsd: true,
    });
    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject(coastal);
  });

  it('returns Coastal for Dakota USD businesses', async () => {
    const request = noLiquidity();
    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      useDakotaUsd: true,
    });
    expect(request).not.toHaveBeenCalled();
    expect(result).toMatchObject(coastal);
  });

  it('ignores an existing named-USD account issuance', async () => {
    const request = noLiquidity();
    const result = await createOnrampPalremitFiatDeposit(request, {
      ...baseParams,
      useGraphUsd: true,
      existingGraphIssuance: {
        providerIssuanceStatus: 'active',
        provisionedAccountId: 'prov-1',
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
    expect(result).toMatchObject(coastal);
  });
});
