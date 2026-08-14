import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/core/partnerWebhooks', () => ({ schedulePartnerWebhook: vi.fn() }));

import { submitKybApplication } from '@/core/kyb/submitKyb';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';

describe('submitKybApplication', () => {
  beforeEach(() => {
    vi.mocked(schedulePartnerWebhook).mockClear();
  });

  it('updates user kybStatus to under_review when currently not_started', async () => {
    const repo = {
      findUserById: vi.fn().mockResolvedValue({ kybStatus: 'not_started' }),
      updateUser: vi.fn().mockResolvedValue(undefined),
      createKybSubmission: vi.fn().mockResolvedValue({
        id: 'sub_1',
        rails: ['USD'],
        priority: 'standard',
        status: 'under_review',
        submittedAt: new Date('2026-03-23T00:00:00.000Z'),
        estimatedCompletionDate: new Date('2026-03-26T00:00:00.000Z'),
      }),
    };

    const res = await submitKybApplication(repo, 'user_1', { rails: ['USD'], priority: 'standard' });

    expect(repo.updateUser).toHaveBeenCalledWith('user_1', { kybStatus: 'under_review' });
    expect(repo.createKybSubmission).toHaveBeenCalledOnce();
    expect(res.status).toBe('under_review');
    expect(schedulePartnerWebhook).toHaveBeenCalledWith(
      'kyb.status_updated',
      expect.objectContaining({
        userId: 'user_1',
        previousStatus: 'not_started',
        kybStatus: 'under_review',
      })
    );
  });

  it('does not downgrade already approved/rejected/suspended users', async () => {
    const repo = {
      findUserById: vi.fn().mockResolvedValue({ kybStatus: 'approved' }),
      updateUser: vi.fn().mockResolvedValue(undefined),
      createKybSubmission: vi.fn().mockResolvedValue({
        id: 'sub_2',
        rails: ['EUR'],
        priority: null,
        status: 'under_review',
        submittedAt: new Date('2026-03-23T00:00:00.000Z'),
        estimatedCompletionDate: new Date('2026-03-26T00:00:00.000Z'),
      }),
    };

    await submitKybApplication(repo, 'user_2', { rails: ['EUR'] });
    expect(repo.updateUser).not.toHaveBeenCalled();
    expect(repo.createKybSubmission).toHaveBeenCalledOnce();
    expect(schedulePartnerWebhook).not.toHaveBeenCalled();
  });
});
