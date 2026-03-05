/**
 * Core: get platform transaction limits. Spec §6 GET /limits.
 * Returns lastUpdated, rails[] (per-rail onramp/offramp limits, highValueSupport, processingTime), globalLimits.
 */

import type { GetLimitsResponse, RailLimits, GlobalLimits } from '../../types/limits';

/** Default platform rails and limits. Can be replaced by config or LP later. */
const DEFAULT_RAILS: RailLimits[] = [
  {
    rail: 'USD',
    currency: 'USD',
    onramp: { minAmount: '10', maxAmount: '100000', currency: 'USD', dailyLimit: '50000', monthlyLimit: '500000' },
    offramp: { minAmount: '10', maxAmount: '100000', currency: 'USD', dailyLimit: '50000', monthlyLimit: '500000' },
    highValueSupport: true,
    processingTime: '1-3 business days',
  },
  {
    rail: 'NGN',
    currency: 'NGN',
    onramp: { minAmount: '1000', maxAmount: '50000000', currency: 'NGN', dailyLimit: '10000000', monthlyLimit: '100000000' },
    offramp: { minAmount: '1000', maxAmount: '50000000', currency: 'NGN', dailyLimit: '10000000', monthlyLimit: '100000000' },
    highValueSupport: true,
    processingTime: '1-2 business days',
  },
  {
    rail: 'EUR',
    currency: 'EUR',
    onramp: { minAmount: '10', maxAmount: '100000', currency: 'EUR', dailyLimit: '50000', monthlyLimit: '500000' },
    offramp: { minAmount: '10', maxAmount: '100000', currency: 'EUR', dailyLimit: '50000', monthlyLimit: '500000' },
    highValueSupport: true,
    processingTime: '1-3 business days',
  },
];

const DEFAULT_GLOBAL: GlobalLimits = {
  minAmount: '10',
  maxAmount: '100000',
  dailyLimit: '50000',
  monthlyLimit: '500000',
};

export interface GetLimitsOptions {
  /** Override rails (e.g. from config or LP). When not provided, default rails are returned. */
  rails?: RailLimits[];
  /** Override global limits. */
  globalLimits?: GlobalLimits;
}

/**
 * Get platform limits. Uses provided options or defaults.
 */
export function getLimits(options?: GetLimitsOptions): GetLimitsResponse {
  const rails = options?.rails ?? DEFAULT_RAILS;
  const globalLimits = options?.globalLimits ?? DEFAULT_GLOBAL;
  return {
    lastUpdated: new Date().toISOString(),
    rails,
    globalLimits,
  };
}
