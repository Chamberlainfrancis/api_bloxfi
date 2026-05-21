/**
 * Map DB account row → API Account shape.
 */

import {
  accountDetailsFromDestination,
  maskAccountDetails,
  maskProviderPayoutDestination,
  parseProviderPayout,
} from '@/core/accounts/providerPayoutHelpers';
import type { Account, AccountHolder, ProviderPayout, RailType } from '@/types/account';

export interface AccountRowLike {
  id: string;
  userId: string;
  railType: string;
  currency: string;
  paymentRail: string;
  accountType: string;
  accountHolder: unknown;
  providerPayout: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function mapAccountRowToApi(row: AccountRowLike, options: { mask: boolean }): Account {
  const pp = parseProviderPayout(row.providerPayout);
  if (!pp) {
    throw new Error('ACCOUNT_MISSING_PROVIDER_PAYOUT');
  }

  const providerPayout: ProviderPayout = options.mask
    ? maskProviderPayoutDestination(pp, true)
    : pp;
  let details = accountDetailsFromDestination(
    providerPayout.corridor.asset,
    providerPayout.corridor.country,
    providerPayout.destination
  );
  if (options.mask) {
    details = maskAccountDetails(details);
  }

  return {
    id: row.id,
    userId: row.userId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rail: {
      currency: row.currency,
      railType: row.railType as RailType,
      paymentRail: row.paymentRail,
    },
    type: row.accountType,
    details,
    accountHolder: (row.accountHolder as AccountHolder | null) ?? undefined,
    providerPayout,
  };
}
