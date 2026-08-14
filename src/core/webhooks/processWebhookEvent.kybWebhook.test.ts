import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/core/partnerWebhooks', () => ({ schedulePartnerWebhook: vi.fn() }));

import { processWebhookEvent } from '@/core/webhooks/processWebhookEvent';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';

function emptyRepos(user: {
  findUserById: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  updateKybRailStatuses?: ReturnType<typeof vi.fn>;
}) {
  return {
    user: {
      findUserById: user.findUserById,
      updateUser: user.updateUser,
      updateKybRailStatuses: user.updateKybRailStatuses ?? vi.fn(),
    },
    onramp: {
      findOnrampById: vi.fn(),
      findOnrampByTxnRef: vi.fn(),
      updateOnrampStatus: vi.fn(),
    },
    offramp: {
      findOfframpById: vi.fn(),
      findOfframpByTxnRef: vi.fn(),
      updateOfframpStatus: vi.fn(),
    },
    highValueRequest: {
      findHighValueRequestById: vi.fn(),
      findHighValueRequestByRequestId: vi.fn(),
      updateHighValueRequestStatus: vi.fn(),
    },
  };
}

describe('processWebhookEvent KYB', () => {
  beforeEach(() => {
    vi.mocked(schedulePartnerWebhook).mockClear();
  });

  it('emits kyb.status_updated after kyb.approved when status changed', async () => {
    const findUserById = vi.fn().mockResolvedValue({ id: 'user_1', kybStatus: 'under_review' });
    const updateUser = vi.fn().mockResolvedValue(undefined);

    await processWebhookEvent(emptyRepos({ findUserById, updateUser }), {
      eventId: 'evt-kyb-approved',
      eventType: 'kyb.approved',
      timestamp: new Date().toISOString(),
      data: { userId: 'user_1', kybStatus: 'approved', rails: ['USD'] },
    });

    expect(updateUser).toHaveBeenCalledWith(
      'user_1',
      expect.objectContaining({ kybStatus: 'approved' })
    );
    expect(schedulePartnerWebhook).toHaveBeenCalledWith(
      'kyb.status_updated',
      expect.objectContaining({ kybStatus: 'approved' })
    );
  });

  it('does not emit kyb.status_updated when inbound status is unchanged', async () => {
    const findUserById = vi.fn().mockResolvedValue({ id: 'user_1', kybStatus: 'approved' });
    const updateUser = vi.fn().mockResolvedValue(undefined);

    await processWebhookEvent(emptyRepos({ findUserById, updateUser }), {
      eventId: 'evt-kyb-already',
      eventType: 'kyb.approved',
      timestamp: new Date().toISOString(),
      data: { userId: 'user_1', kybStatus: 'approved' },
    });

    expect(schedulePartnerWebhook).not.toHaveBeenCalled();
  });
});
