/**
 * Core: submit KYB application. Returns spec §1.6 Submit KYB response shape.
 */

import type { SubmitKybRequest, SubmitKybResponse } from '../../types/user';

export interface UserRepoSubmitKyb {
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
