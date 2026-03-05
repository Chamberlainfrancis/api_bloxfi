/**
 * Core: get user-effective limits. Spec §6 GET /users/:userId/limits.
 * Returns effectiveLimits by currency (based on user's approved rails), limitIncreaseEligibility.
 */

import type {
  GetUserLimitsResponse,
  EffectiveLimit,
  RailLimits,
  LimitIncreaseEligibility,
} from '../../types/limits';

export interface UserLimitsRepo {
  findUserById(id: string): Promise<{
    id: string;
    approvedRails: string[];
  } | null>;
}

export interface GetUserLimitsOptions {
  /** Platform rails (from getLimits). Used to build effective limits for user's approved rails. */
  platformRails: RailLimits[];
}

/**
 * Get effective limits for a user. Limits are filtered by user's approved KYB rails.
 * limitIncreaseEligibility can be extended later (e.g. check for pending high-value request).
 */
export async function getUserLimits(
  userRepo: UserLimitsRepo,
  userId: string,
  options: GetUserLimitsOptions
): Promise<GetUserLimitsResponse | null> {
  const user = await userRepo.findUserById(userId);
  if (!user) return null;

  const approvedSet = new Set(
    (user.approvedRails ?? []).map((r: string) => r.toUpperCase().trim())
  );
  const effectiveLimits: EffectiveLimit[] = options.platformRails
    .filter((r) => approvedSet.has(r.rail.toUpperCase()) || approvedSet.has(r.currency.toUpperCase()))
    .map((r) => ({
      currency: r.currency,
      rail: r.rail,
      onramp: r.onramp,
      offramp: r.offramp,
      highValueSupport: r.highValueSupport,
    }));

  const limitIncreaseEligibility: LimitIncreaseEligibility = {
    eligible: true,
    reason: 'User may submit a high-value request for limit increase.',
  };

  return {
    userId: user.id,
    effectiveLimits,
    limitIncreaseEligibility,
    lastUpdated: new Date().toISOString(),
  };
}
