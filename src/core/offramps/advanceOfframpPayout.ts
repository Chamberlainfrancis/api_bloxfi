/**
 * When offramp is AWAITING_CRYPTO, §5.5 list deposits; if matched, §6.1 fiat withdrawal.
 * Called from GET /offramps/:id to progress state (or rely on BloxFi-shaped webhooks in parallel).
 */

import type { PalremitLiquidityRequestFn } from '@/core/integrations/palremitLiquidity';
import {
  buildPalremitFiatDestinationInformation,
  tryPalremitOfframpFiatPayout,
} from '@/core/integrations/palremitOfframp';
import type { OfframpStatus } from '@/types/offramp';

export interface OfframpRepoAdvance {
  findOfframpById(id: string): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    depositInstructions: unknown;
    timeline: unknown;
  } | null>;
  updateOfframpStatus(
    id: string,
    status: OfframpStatus,
    updates?: {
      timeline?: object | null;
      lpReference?: string | null;
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
  if (!row || row.status !== 'AWAITING_CRYPTO') return;

  const timeline = (row.timeline as Record<string, unknown>) ?? {};
  if (timeline.fiatWithdrawalCompleted === true) return;

  const deposit = row.depositInstructions as {
    address?: string;
    amount?: string;
    currency?: string;
    network?: string;
  } | null;
  if (!deposit?.address || !deposit.currency || !deposit.network) return;

  const source = row.source as { amount?: number; currency?: string; chain?: string };
  const destination = row.destination as {
    amount?: number;
    currency?: string;
    accountId?: string;
    userId?: string;
  };
  const accountId = destination.accountId;
  const userId = row.userId;
  if (!accountId || !destination.amount) return;

  const account = await accountRepo.findAccountByIdAndUser(accountId, userId);
  if (!account) return;

  const destInfo = buildPalremitFiatDestinationInformation(
    account.accountHolder,
    account.regionDetails
  );
  if (!destInfo.account_unique) return;

  const expectedAmount = Number(source.amount) ?? parseFloat(String(source.amount));
  if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) return;

  const sourceNetwork =
    source.chain != null && String(source.chain).trim() !== ''
      ? String(source.chain).trim()
      : deposit.network;

  const result = await tryPalremitOfframpFiatPayout(liquidityRequest, {
    offrampId: row.id,
    requestId: row.requestId,
    expectedCryptoAmount: expectedAmount,
    depositAddress: deposit.address,
    sourceCurrency: deposit.currency.toUpperCase(),
    sourceNetwork,
    destinationAmount: destination.amount,
    destinationCurrency: destination.currency ?? 'NGN',
    destinationInformation: destInfo,
  });

  if (!result) return;

  await offrampRepo.updateOfframpStatus(row.id, 'FIAT_PENDING', {
    timeline: {
      ...timeline,
      fiatWithdrawalReference: result.withdrawalReference,
      fiatInitiatedAt: new Date().toISOString(),
    },
    lpReference: result.withdrawalReference,
  });
}
