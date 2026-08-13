import { describe, it, expect } from 'vitest';
import {
  buildAccountCapabilities,
  mapUsdNamedDepositCapability,
  sanitizeCapabilityFailureReason,
} from '@/core/accounts/accountCapabilities';

describe('sanitizeCapabilityFailureReason', () => {
  it('strips provider brand names and GRAPH_ prefixes', () => {
    expect(sanitizeCapabilityFailureReason('Graph provision failed')).toBe(
      'provider provision failed'
    );
    expect(sanitizeCapabilityFailureReason('GRAPH_PROVISION_STATE_FAILED')).toBe(
      'PROVISION_STATE_FAILED'
    );
  });

  it('returns null for empty', () => {
    expect(sanitizeCapabilityFailureReason(null)).toBeNull();
    expect(sanitizeCapabilityFailureReason('  ')).toBeNull();
  });
});

describe('mapUsdNamedDepositCapability', () => {
  it('maps null issuance to not_started', () => {
    expect(mapUsdNamedDepositCapability({}).status).toBe('not_started');
  });

  it('maps pending', () => {
    expect(
      mapUsdNamedDepositCapability({ providerIssuanceStatus: 'pending' }).status
    ).toBe('pending');
  });

  it('maps active + depositDetails to active', () => {
    expect(
      mapUsdNamedDepositCapability({
        providerIssuanceStatus: 'active',
        depositDetails: {
          bankName: 'LEAD BANK',
          accountNumber: '213604397161',
          routingNumber: '101019644',
          accountHolderName: 'VIKING PLOOM',
          reference: null,
        },
      }).status
    ).toBe('active');
  });

  it('maps active without deposit details to pending', () => {
    expect(
      mapUsdNamedDepositCapability({
        providerIssuanceStatus: 'active',
        depositDetails: null,
      }).status
    ).toBe('pending');
  });

  it('maps failed with sanitized reason', () => {
    const cap = mapUsdNamedDepositCapability({
      providerIssuanceStatus: 'failed',
      providerIssuanceFailureReason: 'GRAPH_PROVISION_STATE_FAILED',
    });
    expect(cap.status).toBe('failed');
    expect(cap.failureReason).toBe('PROVISION_STATE_FAILED');
  });
});

describe('buildAccountCapabilities', () => {
  it('omits capabilities when not Graph-eligible', () => {
    expect(
      buildAccountCapabilities({
        graphUsdEligible: false,
        railType: 'onramp',
        providerIssuanceStatus: 'active',
        depositDetails: {
          bankName: 'B',
          accountNumber: '1',
          routingNumber: '2',
          accountHolderName: 'X',
          reference: null,
        },
      })
    ).toBeUndefined();
  });

  it('omits capabilities for offramp', () => {
    expect(
      buildAccountCapabilities({
        graphUsdEligible: true,
        railType: 'offramp',
        providerIssuanceStatus: 'pending',
      })
    ).toBeUndefined();
  });

  it('includes usdNamedDeposit for Graph-eligible onramp', () => {
    const caps = buildAccountCapabilities({
      graphUsdEligible: true,
      railType: 'onramp',
      providerIssuanceStatus: 'pending',
    });
    expect(caps?.usdNamedDeposit.status).toBe('pending');
  });
});
