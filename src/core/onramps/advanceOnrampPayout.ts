/**
 * Advance onramp after fiat is confirmed:
 * if status is FIAT_PROCESSED, execute Palremit orchestrator crypto withdrawal (`POST /v1/withdrawals`).
 * Completion to COMPLETED is driven by webhook `withdrawal.successful` (`client_reference` = txnRef) after on-chain send.
 */

import type { OnrampStatus } from '@/types/onramp';

export interface OnrampRepoAdvance {
  findOnrampById(id: string): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    txnRef: string | null;
    source: unknown;
    destination: unknown;
    developerFee: unknown;
    receipt: unknown;
    providerRefs: unknown;
  } | null>;
  updateOnrampStatus(
    id: string,
    status: OnrampStatus,
    updates?: { receipt?: object | null; failedReason?: string | null; providerRefs?: object | null }
  ): Promise<unknown>;
}

export interface ExecutePalremitOnrampWithdrawalFn {
  (
    body: {
      source: { amount: number; currency: string; userId: string; transferType?: string };
      destination: {
        currency: string;
        chain: string;
        userId: string;
        externalWalletId: string;
      };
      purposeOfPayment?: string;
      fee: { type: 'FIX' | 'PERCENT'; value: number };
    },
    requestId: string,
    receiveNetCryptoAmount: number,
    destinationAddress: string,
    txnRef: string,
    destinationMemo?: string | null
  ): Promise<{
    withdrawalId: string;
    rawWithdrawalRequest: Record<string, unknown>;
    rawWithdrawalResponse: unknown;
  } | null>;
}

export async function advanceOnrampIfFiatProcessed(
  onrampRepo: OnrampRepoAdvance,
  onrampId: string,
  executePalremitCryptoWithdrawal: ExecutePalremitOnrampWithdrawalFn
): Promise<void> {
  const row = await onrampRepo.findOnrampById(onrampId);
  if (!row?.txnRef) return;

  const receipt = row.receipt != null && typeof row.receipt === 'object' && !Array.isArray(row.receipt)
    ? (row.receipt as Record<string, unknown>)
    : null;
  const hasWithdrawalId =
    receipt != null &&
    typeof receipt.palremitWithdrawalId === 'string' &&
    receipt.palremitWithdrawalId.trim() !== '';

  const eligible =
    row.status === 'FIAT_PROCESSED' ||
    (row.status === 'CRYPTO_FAILED' && !hasWithdrawalId) ||
    ((row.status === 'CRYPTO_INITIATED' || row.status === 'CRYPTO_PENDING') && !hasWithdrawalId);

  if (!eligible) return;

  const source = row.source as {
    amount?: number;
    currency?: string;
    userId?: string;
    transferType?: string;
  };
  const destination = row.destination as {
    amount?: number;
    currency?: string;
    chain?: string;
    walletAddress?: string;
    externalWalletId?: string;
    userId?: string;
    memo?: string;
  };
  const developerFee = row.developerFee as { amount?: string; currency?: string } | null;
  const receiveNet = Number(destination.amount);
  const feeAmount = Number(developerFee?.amount ?? 0);

  if (
    !source.userId ||
    !source.currency ||
    !Number.isFinite(Number(source.amount)) ||
    !destination.userId ||
    !destination.currency ||
    !destination.chain ||
    !destination.externalWalletId ||
    !destination.walletAddress ||
    !Number.isFinite(receiveNet)
  ) {
    return;
  }

  if (row.status === 'FIAT_PROCESSED') {
    await onrampRepo.updateOnrampStatus(row.id, 'CRYPTO_INITIATED');
  }

  let result: {
    withdrawalId: string;
    rawWithdrawalRequest: Record<string, unknown>;
    rawWithdrawalResponse: unknown;
  } | null = null;
  try {
    const destMemo =
      typeof destination.memo === 'string' && destination.memo.trim() !== ''
        ? destination.memo.trim()
        : undefined;
    result = await executePalremitCryptoWithdrawal(
      {
        source: {
          amount: Number(source.amount),
          currency: source.currency,
          userId: source.userId,
          transferType: source.transferType,
        },
        destination: {
          currency: destination.currency,
          chain: destination.chain,
          userId: destination.userId,
          externalWalletId: destination.externalWalletId,
        },
        fee: { type: 'FIX', value: Number.isFinite(feeAmount) ? feeAmount : 0 },
      },
      row.requestId,
      receiveNet,
      destination.walletAddress,
      row.txnRef,
      destMemo
    );
  } catch {
    result = null;
  }

  const orch =
    row.providerRefs != null &&
    typeof row.providerRefs === 'object' &&
    !Array.isArray(row.providerRefs)
      ? (row.providerRefs as Record<string, unknown>).palremitOrchestrator
      : null;
  const orchObj =
    orch != null && typeof orch === 'object' && !Array.isArray(orch)
      ? (orch as Record<string, unknown>)
      : {};

  if (!result) {
    // LP may still process payout; completion is driven by `withdrawal.successful`.
    await onrampRepo.updateOnrampStatus(row.id, 'CRYPTO_PENDING', {
      failedReason: null,
      receipt: {
        txnRef: row.txnRef,
        awaitingWebhookConfirmation: true,
      },
      providerRefs: {
        palremitOrchestrator: {
          ...orchObj,
          withdrawalStatus: 'pending',
          withdrawalInitiationFailed: true,
        },
      },
    });
    return;
  }

  await onrampRepo.updateOnrampStatus(row.id, 'CRYPTO_PENDING', {
    failedReason: null,
    receipt: {
      txnRef: row.txnRef,
      palremitWithdrawalId: result.withdrawalId,
      awaitingWebhookConfirmation: true,
    },
    providerRefs: {
      palremitOrchestrator: {
        ...orchObj,
        palremitWithdrawalId: result.withdrawalId,
        withdrawalStatus: 'pending',
        withdrawalInitiationFailed: false,
        rawCryptoWithdrawalRequest: result.rawWithdrawalRequest,
        rawCryptoWithdrawalResponse: result.rawWithdrawalResponse,
      },
    },
  });
}
