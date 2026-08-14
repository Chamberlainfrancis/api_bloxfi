/**
 * Core: submit KYB application. Returns spec §1.6 Submit KYB response shape.
 */

import type { KYBStatus, SubmitKybRequest, SubmitKybResponse } from '@/types/user';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';

export interface UserRepoSubmitKyb {
  findUserById(userId: string): Promise<{ kybStatus: KYBStatus } | null>;
  updateUser(
    userId: string,
    data: { kybStatus?: KYBStatus; approvedRails?: string[]; status?: 'active' | 'inactive' | 'suspended' }
  ): Promise<void>;
  createKybSubmission(
    userId: string,
    data: SubmitKybRequest,
    estimatedCompletionDate?: Date
  ): Promise<{
    id: string;
    rails: string[];
    priority: string | null;
    status: string;
    submittedAt: Date;
    estimatedCompletionDate: Date | null;
  }>;
}

/** Default: 3 business days from now for estimated completion. */
function defaultEstimatedCompletionDate(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return d;
}

export async function submitKybApplication(
  repo: UserRepoSubmitKyb,
  userId: string,
  data: SubmitKybRequest
): Promise<SubmitKybResponse> {
  const user = await repo.findUserById(userId);
  // Move user-level KYB summary into review on submission.
  // Keep terminal/restrictive states unchanged until webhook/admin decision.
  if (user && (user.kybStatus === 'not_started' || user.kybStatus === 'incomplete')) {
    await repo.updateUser(userId, { kybStatus: 'under_review' });
    schedulePartnerWebhook('kyb.status_updated', {
      userId,
      previousStatus: user.kybStatus,
      kybStatus: 'under_review',
    });
  }
  const estimated = defaultEstimatedCompletionDate();
  const submission = await repo.createKybSubmission(userId, data, estimated);
  return {
    submissionId: submission.id,
    status: submission.status,
    rails: submission.rails,
    submittedAt: submission.submittedAt.toISOString(),
    estimatedCompletionDate: (submission.estimatedCompletionDate ?? estimated).toISOString(),
  };
}
