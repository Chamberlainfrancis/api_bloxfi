/**
 * Operator reissue: Palremit already has a failed/refunded payout. Mint a new
 * withdrawal id (fresh OwlPay + treasury idempotency) and attach it here.
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import { reissuePalremitWithdrawal } from '@/core/integrations/palremitLiquidity';
import { beneficiaryDobFromCustomer } from '@/core/integrations/palremitOfframp';
import { findOfframpAccountByIdAndUser } from '@/db/repositories/account.repo';
import { findUserById } from '@/db/repositories/user.repo';
import type { OfframpStatus } from '@/types/offramp';
import { offrampFiatWithdrawalId } from '@/core/offramps/offrampFiatRetry';

export interface OfframpRepoReissue {
  findOfframpById(id: string): Promise<{
    id: string;
    txnRef: string | null;
    userId?: string;
    status: string;
    destination?: unknown;
    timeline: unknown;
    providerRefs: unknown;
  } | null>;
  updateOfframpStatus(
    id: string,
    status: OfframpStatus,
    updates?: {
      timeline?: object | null;
      lpReference?: string | null;
      providerRefs?: object | null;
      failedReason?: string | null;
      receipt?: object | null;
    },
    options?: { emitPartnerWebhook?: boolean }
  ): Promise<unknown>;
}

export type ReissueOfframpFiatPayoutResult =
  | { status: 'reissued'; withdrawalId: string; previousWithdrawalId: string; txnRef: string }
  | { status: 'rejected'; code: string; message: string; statusCode: number };

function orchFrom(providerRefs: unknown): Record<string, unknown> {
  if (providerRefs == null || typeof providerRefs !== 'object' || Array.isArray(providerRefs)) {
    return {};
  }
  const o = (providerRefs as Record<string, unknown>).palremitOrchestrator;
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return {};
  return { ...(o as Record<string, unknown>) };
}

function bankCodeFromProviderPayout(providerPayout: unknown): string {
  if (providerPayout == null || typeof providerPayout !== 'object') return '';
  const dest = (providerPayout as { destination?: unknown }).destination;
  if (dest == null || typeof dest !== 'object') return '';
  const code = (dest as { bank_code?: unknown }).bank_code;
  const trimmed = typeof code === 'string' ? code.trim() : '';
  return /^[A-Za-z0-9]{1,20}$/.test(trimmed) ? trimmed : '';
}

export async function reissueOfframpFiatPayout(
  offrampRepo: OfframpRepoReissue,
  liquidityRequest: PalremitLiquidityRequestFn,
  params: { offrampId: string; withdrawalId: string }
): Promise<ReissueOfframpFiatPayoutResult> {
  const row = await offrampRepo.findOfframpById(params.offrampId);
  if (!row?.txnRef) {
    return {
      status: 'rejected',
      code: 'NOT_FOUND',
      message: 'Offramp not found',
      statusCode: 404,
    };
  }

  const currentId = offrampFiatWithdrawalId(row);
  if (!currentId || currentId !== params.withdrawalId) {
    return {
      status: 'rejected',
      code: 'PAYOUT_MISMATCH',
      message: 'Offramp is no longer attached to that Palremit payout',
      statusCode: 409,
    };
  }

  const dest =
    row.destination != null && typeof row.destination === 'object' && !Array.isArray(row.destination)
      ? (row.destination as { accountId?: unknown })
      : {};
  const accountId = typeof dest.accountId === 'string' ? dest.accountId : '';
  const userId = typeof row.userId === 'string' ? row.userId : '';
  let accountHolder: unknown;
  let accountBankCode = '';
  if (accountId && userId) {
    const account = await findOfframpAccountByIdAndUser(accountId, userId);
    accountHolder = account?.accountHolder;
    accountBankCode = bankCodeFromProviderPayout(account?.providerPayout);
  }
  const user = userId ? await findUserById(userId) : null;
  const beneficiaryDob = beneficiaryDobFromCustomer({
    accountHolder,
    legalRepresentative: user?.legalRepresentative,
  });

  // Palremit only fills fields the failed attempt left blank, so sending the
  // account's current bank code lets a corrected account (e.g. a CAD
  // Institution Number added after a rejection) reach the provider.
  const overlayDestination = {
    ...(beneficiaryDob ? { beneficiary: { dob: beneficiaryDob } } : {}),
    ...(accountBankCode ? { bank_code: accountBankCode } : {}),
  };
  const created = await reissuePalremitWithdrawal(
    liquidityRequest,
    params.withdrawalId,
    `offramp-fiat-reissue:${row.txnRef}:${params.withdrawalId}`,
    Object.keys(overlayDestination).length ? { destination: overlayDestination } : undefined
  );
  if (!created.ok) {
    return {
      status: 'rejected',
      code: 'FIAT_PAYOUT_REISSUE_FAILED',
      message: created.message,
      statusCode: created.httpStatus >= 400 && created.httpStatus < 600 ? created.httpStatus : 422,
    };
  }

  const newId = created.id;
  const timeline =
    row.timeline != null && typeof row.timeline === 'object' && !Array.isArray(row.timeline)
      ? { ...(row.timeline as Record<string, unknown>) }
      : {};
  const orch = orchFrom(row.providerRefs);
  const prevIds = Array.isArray(orch.supersededWithdrawalIds)
    ? [...(orch.supersededWithdrawalIds as unknown[])]
    : [];
  const now = new Date().toISOString();

  await offrampRepo.updateOfframpStatus(
    row.id,
    'FIAT_PENDING',
    {
      failedReason: null,
      lpReference: newId,
      timeline: {
        ...timeline,
        fiatWithdrawalId: newId,
        fiatInitiatedAt: now,
        fiatWithdrawalCompleted: false,
        completedAt: null,
        fiatPayoutLastError: null,
        fiatPayoutLastErrorAt: null,
      },
      providerRefs: {
        palremitOrchestrator: {
          ...orch,
          palremitWithdrawalId: newId,
          withdrawalStatus: 'pending',
          markedManually: false,
          completedAt: null,
          supersededWithdrawalIds: [...prevIds, params.withdrawalId],
          fiatPayoutLastError: null,
          fiatPayoutLastErrorAt: null,
        },
      },
    },
    { emitPartnerWebhook: false }
  );

  return {
    status: 'reissued',
    withdrawalId: newId,
    previousWithdrawalId: params.withdrawalId,
    txnRef: row.txnRef,
  };
}
