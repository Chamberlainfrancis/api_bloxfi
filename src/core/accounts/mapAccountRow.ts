/**
 * Map DB account row → API Account shape.
 */

import {
  accountDetailsFromDestination,
  maskAccountDetails,
  maskProviderPayoutDestination,
  parseProviderPayout,
} from '@/core/accounts/providerPayoutHelpers';
import type {
  Account,
  AccountHolder,
  AccountMetadata,
  ProviderPayout,
  RailType,
} from '@/types/account';

export interface AccountRowLike {
  id: string;
  userId: string;
  railType: string;
  currency: string;
  paymentRail: string;
  accountType: string;
  accountHolder: unknown;
  providerPayout: unknown;
  /** SwipeLux customer id (cus_*) once known. Onramp only. */
  swipeluxCustomerId?: string | null;
  /** 'pending_import' | 'approved' | 'rejected' | 'failed'. Onramp only. */
  kycImportStatus?: string | null;
  sofQuestionnaire?: unknown;
  sourceOfFundsDocumentPath?: string | null;
  metadata?: unknown;
  createdAt: Date;
  updatedAt: Date;
}

export function mapAccountRowToApi(row: AccountRowLike, options: { mask: boolean }): Account {
  if (row.railType === 'onramp') {
    // Onramp rows are Sumsub share-token KYC imports (Task 6/7) — no Palremit payout corridor,
    // so there is no providerPayout to parse and no bank `details` to derive.
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
      details: null,
      accountHolder: (row.accountHolder as AccountHolder | null) ?? undefined,
      providerPayout: undefined,
      swipeluxCustomerId: row.swipeluxCustomerId ?? null,
      kycImportStatus: row.kycImportStatus ?? null,
      sofQuestionnaire: (row.sofQuestionnaire as Record<string, unknown> | null) ?? null,
      sourceOfFundsDocumentPath: row.sourceOfFundsDocumentPath ?? null,
      metadata: (row.metadata as AccountMetadata | null) ?? null,
    };
  }

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
