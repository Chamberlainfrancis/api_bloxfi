/**
 * When offramp is CRYPTO_CONFIRMED, create Palremit fiat withdrawal (/v1/withdrawals).
 * Deposit confirmation is webhook-driven (`deposit.credited` → CRYPTO_CONFIRMED).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  buildPalremitFiatDestinationInformation,
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
  findAccountByIdAndUser(
    accountId: string,
    userId: string
  ): Promise<{
    accountHolder: unknown;
    regionDetails: unknown;
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

  const source = row.source as { amount?: number; currency?: string; chain?: string };
  const destination = row.destination as {
    amount?: number;
    currency?: string;
    accountId?: string;
    userId?: string;
  };
  const accountId = destination.accountId;
  const userId = row.userId;
  if (!accountId || destination.amount == null) return;

  const account = await accountRepo.findAccountByIdAndUser(accountId, userId);
  if (!account) return;

  const destInfo = buildPalremitFiatDestinationInformation(
    account.accountHolder,
    account.regionDetails
  );
  if (!destInfo.account_unique) return;

  const destinationAmount = Number(destination.amount);
  if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) return;

  const result = await createPalremitOfframpFiatWithdrawal(liquidityRequest, {
    txnRef: row.txnRef,
    destinationAmount,
    destinationCurrency: destination.currency ?? 'NGN',
    destinationInformation: destInfo,
  });

  if (!result) return;

  const orch = (
    row.providerRefs && typeof row.providerRefs === 'object' && !Array.isArray(row.providerRefs)
      ? (row.providerRefs as Record<string, unknown>).palremitOrchestrator
      : null
  ) as Record<string, unknown> | null;

  await offrampRepo.updateOfframpStatus(row.id, 'FIAT_PENDING', {
    timeline: {
      ...timeline,
      fiatWithdrawalId: result.withdrawalId,
      fiatInitiatedAt: new Date().toISOString(),
    },
    lpReference: result.withdrawalId,
    providerRefs: {
      palremitOrchestrator: {
        ...(orch && typeof orch === 'object' ? orch : {}),
        withdrawalStatus: 'pending',
        palremitWithdrawalId: result.withdrawalId,
        rawFiatWithdrawalRequest: result.rawRequest,
        rawFiatWithdrawalResponse: result.rawResponse,
      },
    },
  });
}
