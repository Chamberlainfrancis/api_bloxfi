/**
 * Advance onramp after fiat is confirmed:
 * if status is FIAT_PROCESSED, execute Palremit §6.2 crypto withdrawal.
 */

import type { OnrampStatus } from '@/types/onramp';

export interface OnrampRepoAdvance {
  findOnrampById(id: string): Promise<{
    id: string;
    requestId: string;
    userId: string;
    status: string;
    source: unknown;
    destination: unknown;
    developerFee: unknown;
  } | null>;
  updateOnrampStatus(
    id: string,
    status: OnrampStatus,
    updates?: { receipt?: object | null; failedReason?: string | null }
  ): Promise<unknown>;
}

export interface ExecutePalremitOnrampWithdrawalFn {
  (
    body: {
      source: { amount: number; currency: string; userId: string; accountId: string; transferType?: string };
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
    destinationAddress: string
  ): Promise<{ prepareReference: string } | null>;
}

export async function advanceOnrampIfFiatProcessed(
  onrampRepo: OnrampRepoAdvance,
  onrampId: string,
  executePalremitCryptoWithdrawal: ExecutePalremitOnrampWithdrawalFn
): Promise<void> {
  const row = await onrampRepo.findOnrampById(onrampId);
  if (!row) return;

  // Allow retry if we set CRYPTO_INITIATED but never stored the Palremit prepare reference.
  const receipt = row as unknown as { receipt?: unknown };
  const receiptObj =
    receipt.receipt != null && typeof receipt.receipt === 'object' && !Array.isArray(receipt.receipt)
      ? (receipt.receipt as Record<string, unknown>)
      : null;
  const hasTxHash =
    receiptObj != null &&
    typeof receiptObj.transactionHash === 'string' &&
    receiptObj.transactionHash.trim() !== '';

  const eligible = row.status === 'FIAT_PROCESSED' || (row.status === 'CRYPTO_INITIATED' && !hasTxHash);
  if (!eligible) return;

  const source = row.source as {
    amount?: number;
    currency?: string;
    userId?: string;
    accountId?: string;
    transferType?: string;
  };
  const destination = row.destination as {
    amount?: number;
    currency?: string;
    chain?: string;
    walletAddress?: string;
    externalWalletId?: string;
    userId?: string;
  };
  const developerFee = row.developerFee as { amount?: string; currency?: string } | null;
  const receiveNet = Number(destination.amount);
  const feeAmount = Number(developerFee?.amount ?? 0);

  if (
    !source.userId ||
    !source.accountId ||
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

  if (row.status !== 'CRYPTO_INITIATED') {
    await onrampRepo.updateOnrampStatus(row.id, 'CRYPTO_INITIATED');
  }

  let result: { prepareReference: string } | null = null;
  try {
    result = await executePalremitCryptoWithdrawal(
    {
      source: {
        amount: Number(source.amount),
        currency: source.currency,
        userId: source.userId,
        accountId: source.accountId,
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
    destination.walletAddress
    );
  } catch {
    result = null;
  }

  if (!result) {
    await onrampRepo.updateOnrampStatus(row.id, 'CRYPTO_FAILED', {
      failedReason: 'PALREMIT_ONRAMP_WITHDRAWAL_FAILED',
    });
    return;
  }

  await onrampRepo.updateOnrampStatus(row.id, 'COMPLETED', {
    receipt: { transactionHash: result.prepareReference },
  });
}
