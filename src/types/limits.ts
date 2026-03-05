/**
 * Transaction limits and high-value request types per spec §6.
 * Platform and user limits, high-value support, KYB tier.
 */

// --- GET /limits (platform limits) ---

export interface DirectionalLimits {
  minAmount?: string;
  maxAmount?: string;
  currency: string;
  dailyLimit?: string;
  monthlyLimit?: string;
}

export interface RailLimits {
  rail: string;
  currency: string;
  onramp?: DirectionalLimits;
  offramp?: DirectionalLimits;
  highValueSupport?: boolean;
  processingTime?: string;
}

export interface GlobalLimits {
  minAmount?: string;
  maxAmount?: string;
  dailyLimit?: string;
  monthlyLimit?: string;
  currency?: string;
}

export interface GetLimitsResponse {
  lastUpdated: string;
  rails: RailLimits[];
  globalLimits?: GlobalLimits;
}

// --- GET /users/:userId/limits (user-effective limits) ---

export interface EffectiveLimit {
  currency: string;
  rail?: string;
  onramp?: DirectionalLimits;
  offramp?: DirectionalLimits;
  highValueSupport?: boolean;
}

export interface LimitIncreaseEligibility {
  eligible: boolean;
  reason?: string;
  requestedAt?: string;
}

export interface GetUserLimitsResponse {
  userId: string;
  effectiveLimits: EffectiveLimit[];
  limitIncreaseEligibility?: LimitIncreaseEligibility;
  lastUpdated: string;
}

// --- High-value request ---

export type HighValueRequestStatus =
  | 'pending'
  | 'under_review'
  | 'approved'
  | 'rejected';

export interface HighValueRequest {
  requestId: string;
  userId: string;
  status: HighValueRequestStatus;
  currency?: string;
  requestedLimit?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}

export interface CreateHighValueRequestInput {
  requestId: string;
  userId: string;
  currency?: string;
  requestedLimit?: string;
  reason?: string;
}

export interface CreateHighValueRequestResponse {
  requestId: string;
  userId: string;
  status: HighValueRequestStatus;
  createdAt: string;
  message?: string;
}

export interface GetHighValueRequestResponse {
  requestId: string;
  userId: string;
  status: HighValueRequestStatus;
  currency?: string;
  requestedLimit?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
}
