/**
 * Resolve persisted onramp fees from `fees` JSON, with legacy `developerFee` fallback.
 */

import type { OnrampFees } from '@/types/onramp';

export function resolveOnrampFees(row: {
  fees?: unknown;
  developerFee?: unknown;
}): OnrampFees | null {
  if (row.fees != null && typeof row.fees === 'object' && !Array.isArray(row.fees)) {
    return row.fees as OnrampFees;
  }

  const legacy = row.developerFee as { amount?: string; currency?: string } | null;
  if (legacy?.amount != null && String(legacy.amount).trim() !== '') {
    const amount = String(legacy.amount);
    return {
      platformFee: {
        type: 'FLAT',
        value: amount,
        amount,
        currency: legacy.currency?.trim().toLowerCase() ?? '',
        walletAddress: '',
      },
    };
  }

  return null;
}
