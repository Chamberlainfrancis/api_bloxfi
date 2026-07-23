/**
 * When offramp is CRYPTO_CONFIRMED, create Palremit fiat withdrawal (/v1/withdrawals).
 * Deposit confirmation is webhook-driven (`deposit.credited` → CRYPTO_CONFIRMED).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  buildWithdrawalFromAccount,
  createPalremitOfframpFiatWithdrawal,
} from '@/core/integrations/palremitOfframp';
import type { OfframpStatus } from '@/types/offramp';

export interface OfframpRepoAdvance {
  findOfframpById(id: string): Promise<{
    id: string;
    requestId: string;
    txnRef: string | null;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    depositInstructions: unknown;
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
    }
  ): Promise<unknown>;
}

export interface AccountRepoAdvance {
  findOfframpAccountByIdAndUser(
    accountId: string,
    userId: string
  ): Promise<{
    currency: string;
    accountHolder: unknown;
    providerPayout: unknown;
  } | null>;
}

export async function advanceOfframpIfDepositReady(
  offrampRepo: OfframpRepoAdvance,
  accountRepo: AccountRepoAdvance,
  liquidityRequest: PalremitLiquidityRequestFn,
  offrampId: string
): Promise<void> {
  const row = await offrampRepo.findOfframpById(offrampId);
  if (!row?.txnRef) return;

  if (row.status !== 'CRYPTO_CONFIRMED') return;

  const timeline = (row.timeline as Record<string, unknown>) ?? {};
  if (timeline.fiatWithdrawalCompleted === true) return;
  if (timeline.fiatWithdrawalId != null) return;

  const destination = row.destination as {
    amount?: number;
    currency?: string;
    accountId?: string;
    userId?: string;
    purposeOfPayment?: string;
    metadata?: Record<string, unknown>;
  };
  const accountId = destination.accountId;
  const userId = row.userId;
  if (!accountId || destination.amount == null) return;

  const account = await accountRepo.findOfframpAccountByIdAndUser(accountId, userId);
  if (!account) return;

  const destinationAmount = Number(destination.amount);
  if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) return;

  const holderEmail =
    account.accountHolder != null &&
    typeof account.accountHolder === 'object' &&
    !Array.isArray(account.accountHolder) &&
    typeof (account.accountHolder as { email?: unknown }).email === 'string'
      ? (account.accountHolder as { email: string }).email
      : undefined;

  // Prisma User.id — always populated, unlike palremitChannelUserId (defined
  // but never actually written by anything today). Stable per business.
  const withdrawalBody = buildWithdrawalFromAccount({
    txnRef: row.txnRef,
    destinationAmount,
    providerPayout: account.providerPayout,
    purposeOfPayment: destination.purposeOfPayment,
    metadata: destination.metadata,
    businessReference: userId,
    accountHolderEmail: holderEmail,
  });
  if (!withdrawalBody) return;

  const result = await createPalremitOfframpFiatWithdrawal(liquidityRequest, {
    body: withdrawalBody,
    txnRef: row.txnRef,
  });

  if (!result) return;

  const orch = (
    row.providerRefs && typeof row.providerRefs === 'object' && !Array.isArray(row.providerRefs)
      ? (row.providerRefs as Record<string, unknown>).palremitOrchestrator
      : null
  ) as Record<string, unknown> | null;

  if (!result.ok) {
    const now = new Date().toISOString();
    await offrampRepo.updateOfframpStatus(row.id, 'CRYPTO_CONFIRMED', {
      timeline: {
        ...timeline,
        fiatPayoutLastError: result.error,
        fiatPayoutLastErrorAt: now,
      },
      providerRefs: {
        palremitOrchestrator: {
          ...(orch && typeof orch === 'object' ? orch : {}),
          fiatPayoutLastError: result.error,
          fiatPayoutLastErrorAt: now,
          rawFiatWithdrawalRequest: withdrawalBody,
          rawFiatWithdrawalResponse: result.rawResponse ?? null,
        },
      },
    });
    return;
  }

  await offrampRepo.updateOfframpStatus(row.id, 'FIAT_PENDING', {
    timeline: {
      ...timeline,
      fiatWithdrawalId: result.withdrawalId,
      fiatInitiatedAt: new Date().toISOString(),
      fiatPayoutLastError: null,
      fiatPayoutLastErrorAt: null,
    },
    lpReference: result.withdrawalId,
    providerRefs: {
      palremitOrchestrator: {
        ...(orch && typeof orch === 'object' ? orch : {}),
        withdrawalStatus: 'pending',
        palremitWithdrawalId: result.withdrawalId,
        fiatPayoutLastError: null,
        fiatPayoutLastErrorAt: null,
        rawFiatWithdrawalRequest: result.rawRequest,
        rawFiatWithdrawalResponse: result.rawResponse,
      },
    },
  });
}
