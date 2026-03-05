/**
 * Core: update KYB information. Returns spec §1.3 Update KYB response shape.
 */

import type { UpdateKybRequest, UpdateKybResponse } from '../../types/user';

export interface UserRepoUpdateKyb {
  upsertKybInfo(userId: string, data: UpdateKybRequest): Promise<void>;
}

const DEFAULT_NEXT_STEPS = [
  'Upload certificate of incorporation',
  'Upload proof of business address',
  'Upload director identification documents',
];

export async function updateKybInformation(
  repo: UserRepoUpdateKyb,
  userId: string,
  data: UpdateKybRequest
): Promise<UpdateKybResponse> {
  await repo.upsertKybInfo(userId, data);
  return {
    status: 'information_received',
    missingFields: [],
    nextSteps: DEFAULT_NEXT_STEPS,
  };
}
