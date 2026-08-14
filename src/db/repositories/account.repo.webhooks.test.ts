import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/partnerWebhooks', () => ({ schedulePartnerWebhook: vi.fn() }));

import {
  capabilityStatusChanged,
  maybeScheduleAccountCapabilitiesUpdated,
} from '@/core/partnerWebhooks/capabilities';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';

const activeDeposit = {
  bankName: 'Oval Bank',
  accountNumber: '9992740191426913',
  routingNumber: '084106768',
  accountHolderName: 'Gilles Eykelberg',
  reference: 'GRAPH-1',
};

describe('capabilityStatusChanged', () => {
  it('is true when mapped usdNamedDeposit status changes', () => {
    expect(
      capabilityStatusChanged(
        { providerIssuanceStatus: null },
        { providerIssuanceStatus: 'pending' }
      )
    ).toBe(true);
    expect(
      capabilityStatusChanged(
        { providerIssuanceStatus: 'pending' },
        { providerIssuanceStatus: 'active', depositDetails: activeDeposit }
      )
    ).toBe(true);
  });

  it('is false when mapped status is unchanged', () => {
    expect(
      capabilityStatusChanged(
        { providerIssuanceStatus: 'pending' },
        { providerIssuanceStatus: 'pending' }
      )
    ).toBe(false);
    expect(
      capabilityStatusChanged(
        { providerIssuanceStatus: 'active', depositDetails: activeDeposit },
        { providerIssuanceStatus: 'active', depositDetails: { ...activeDeposit, reference: 'GRAPH-2' } }
      )
    ).toBe(false);
  });
});

describe('maybeScheduleAccountCapabilitiesUpdated', () => {
  beforeEach(() => {
    vi.mocked(schedulePartnerWebhook).mockClear();
  });

  it('emits depositDetails only when usdNamedDeposit is active', () => {
    maybeScheduleAccountCapabilitiesUpdated(
      { providerIssuanceStatus: 'pending' },
      {
        id: 'acc-onramp-1',
        userId: 'user-1',
        providerIssuanceStatus: 'active',
        depositDetails: activeDeposit,
      }
    );
    expect(schedulePartnerWebhook).toHaveBeenCalledWith(
      'account.capabilities.updated',
      expect.objectContaining({
        accountId: 'acc-onramp-1',
        userId: 'user-1',
        capabilities: { usdNamedDeposit: expect.objectContaining({ status: 'active' }) },
        depositDetails: activeDeposit,
      })
    );
  });

  it('does not emit when mapped status is unchanged', () => {
    maybeScheduleAccountCapabilitiesUpdated(
      { providerIssuanceStatus: 'pending' },
      { id: 'acc-onramp-1', userId: 'user-1', providerIssuanceStatus: 'pending' }
    );
    expect(schedulePartnerWebhook).not.toHaveBeenCalled();
  });
});
