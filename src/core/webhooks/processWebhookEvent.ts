/**
 * Core: process inbound webhook events from LPs / Palremit. Update state via repository interfaces.
 * Money-flow events (§5–§6): match strictly on payload `data.txnRef` ↔ DB `txnRef` (no heuristics).
 * No Express/Prisma; receives repos via DI.
 */

import type { InboundWebhookPayload } from '@/types/webhook';
import type { OnrampStatus } from '@/types/onramp';
import type { OfframpStatus } from '@/types/offramp';
import type { KYBStatus } from '@/types/user';
import type { HighValueRequestStatus } from '@/types/limits';
import { isOnrampTxnRef, isOfframpTxnRef } from '@/utils/txnRef';

export interface WebhookRepos {
  user: {
    findUserById(id: string): Promise<{ id: string } | null>;
    updateUser(
      id: string,
      data: { kybStatus?: KYBStatus; approvedRails?: string[] }
    ): Promise<void>;
    updateKybRailStatuses(
      userId: string,
      updates: { rail: string; status: string; approvedAt?: Date }[]
    ): Promise<void>;
  };
  onramp: {
    findOnrampById(id: string): Promise<{ id: string; status?: string } | null>;
    findOnrampByTxnRef(txnRef: string): Promise<{ id: string; status: string } | null>;
    updateOnrampStatus(
      id: string,
      status: OnrampStatus,
      updates?: {
        receipt?: object | null;
        failedReason?: string | null;
        providerRefs?: object | null;
      }
    ): Promise<unknown>;
    advanceOnrampAfterFiatWebhook?(onrampId: string): Promise<void>;
  };
  offramp: {
    findOfframpById(id: string): Promise<{ id: string; status?: string } | null>;
    findOfframpByTxnRef(txnRef: string): Promise<{ id: string; status: string } | null>;
    updateOfframpStatus(
      id: string,
      status: OfframpStatus,
      updates?: {
        timeline?: object | null;
        receipt?: object | null;
        failedReason?: string | null;
        refundDetails?: object | null;
        lpReference?: string | null;
        providerRefs?: object | null;
      }
    ): Promise<unknown>;
    advanceOfframpAfterCryptoWebhook?(offrampId: string): Promise<void>;
  };
  highValueRequest: {
    findHighValueRequestById(id: string): Promise<{ id: string } | null>;
    findHighValueRequestByRequestId(requestId: string): Promise<{ id: string } | null>;
    updateHighValueRequestStatus(id: string, status: HighValueRequestStatus): Promise<unknown>;
  };
}

const OFFRAMP_STATUS_MAP: Record<string, OfframpStatus> = {
  CREATED: 'CREATED',
  AWAITING_CRYPTO: 'AWAITING_CRYPTO',
  CRYPTO_PENDING: 'CRYPTO_PENDING',
  CRYPTO_RECEIVED: 'CRYPTO_RECEIVED',
  CRYPTO_CONFIRMED: 'CRYPTO_CONFIRMED',
  PROCESSING_FEE: 'PROCESSING_FEE',
  FEE_PROCESSED: 'FEE_PROCESSED',
  FIAT_INITIATED: 'FIAT_INITIATED',
  FIAT_PENDING: 'FIAT_PENDING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
  CRYPTO_FAILED: 'CRYPTO_FAILED',
  FIAT_FAILED: 'FIAT_FAILED',
  EXPIRED: 'EXPIRED',
};

function toOfframpStatus(s: string): OfframpStatus {
  return OFFRAMP_STATUS_MAP[s] ?? 'CREATED';
}

function toKybStatus(s: string): KYBStatus {
  const v = s?.toLowerCase();
  if (['not_started', 'incomplete', 'under_review', 'approved', 'rejected', 'suspended'].includes(v)) {
    return v as KYBStatus;
  }
  return 'under_review';
}

/** Require Palremit to send `data.txnRef` (contract). */
function requireTxnRef(d: Record<string, unknown>): string | null {
  const v = d.txnRef;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/**
 * Process a single webhook event. Updates state via repos; throws on unrecoverable errors.
 */
export async function processWebhookEvent(
  repos: WebhookRepos,
  payload: InboundWebhookPayload
): Promise<void> {
  const { eventType, data } = payload;
  const d = data as Record<string, unknown>;

  switch (eventType) {
    case 'deposit.successful': {
      const txnRef = requireTxnRef(d);
      if (!txnRef) break;

      const currency = String(d.currency ?? '').trim().toUpperCase();
      if (!currency) break;

      if (currency === 'NGN') {
        if (!isOnrampTxnRef(txnRef)) break;
        const onramp = await repos.onramp.findOnrampByTxnRef(txnRef);
        if (!onramp) break;
        if (!['AWAITING_FUNDS', 'FIAT_PENDING'].includes(onramp.status)) break;

        await repos.onramp.updateOnrampStatus(onramp.id, 'FIAT_PROCESSED', {
          receipt: { provider: 'palremit', eventType, data: d },
          providerRefs: {
            webhookDepositSuccessful: {
              reference: d.reference,
              id: d.id,
            },
          },
        });
        if (repos.onramp.advanceOnrampAfterFiatWebhook) {
          try {
            await repos.onramp.advanceOnrampAfterFiatWebhook(onramp.id);
          } catch (e) {
            console.error('[webhooks] advanceOnrampAfterFiatWebhook failed', onramp.id, e);
          }
        }
        break;
      }

      if (!isOfframpTxnRef(txnRef)) break;
      const offramp = await repos.offramp.findOfframpByTxnRef(txnRef);
      if (!offramp) break;
      if (!['AWAITING_CRYPTO', 'CRYPTO_PENDING', 'CRYPTO_RECEIVED'].includes(offramp.status)) break;

      await repos.offramp.updateOfframpStatus(offramp.id, 'CRYPTO_CONFIRMED', {
        receipt: {
          provider: 'palremit',
          txId: d.tx_id ?? null,
          txLink: d.tx_link ?? null,
          confirmations: d.confirmations ?? null,
          currency,
          network: d.network ?? null,
          amount: d.amount ?? null,
          raw: d,
        },
        timeline: { cryptoConfirmedAt: new Date().toISOString() } as object,
        providerRefs: {
          webhookDepositSuccessful: {
            reference: d.reference,
            id: d.id,
            tx_id: d.tx_id,
          },
        },
      });
      if (repos.offramp.advanceOfframpAfterCryptoWebhook) {
        try {
          await repos.offramp.advanceOfframpAfterCryptoWebhook(offramp.id);
        } catch (e) {
          console.error('[webhooks] advanceOfframpAfterCryptoWebhook failed', offramp.id, e);
        }
      }
      break;
    }

    case 'deposit.transaction.confirmation': {
      const txnRef = requireTxnRef(d);
      if (!txnRef || !isOfframpTxnRef(txnRef)) break;
      const offramp = await repos.offramp.findOfframpByTxnRef(txnRef);
      if (!offramp) break;
      const allowed = ['AWAITING_CRYPTO', 'CRYPTO_PENDING', 'CRYPTO_RECEIVED', 'CRYPTO_CONFIRMED'];
      if (!allowed.includes(offramp.status)) break;

      await repos.offramp.updateOfframpStatus(offramp.id, toOfframpStatus(offramp.status), {
        receipt: {
          provider: 'palremit',
          eventType,
          confirmations: d.confirmations ?? null,
          tx_id: d.tx_id ?? null,
          raw: d,
        },
        providerRefs: {
          webhookDepositConfirmation: { id: d.id, tx_id: d.tx_id },
        },
      });
      break;
    }

    case 'deposit.address.created': {
      const txnRef = requireTxnRef(d);
      if (!txnRef || !isOfframpTxnRef(txnRef)) break;
      const offramp = await repos.offramp.findOfframpByTxnRef(txnRef);
      if (!offramp) break;

      await repos.offramp.updateOfframpStatus(offramp.id, toOfframpStatus(offramp.status), {
        providerRefs: {
          webhookDepositAddressCreated: {
            channel_address_id: d.channel_address_id,
            address: d.address,
          },
        },
      });
      break;
    }

    case 'withdraw.successful': {
      const txnRef = requireTxnRef(d);
      if (!txnRef) break;

      const receipt = {
        provider: 'palremit',
        reference: d.reference,
        destinationTxId: d.destination_tx_id ?? null,
        destinationTxLink: d.destination_tx_link ?? null,
        raw: d,
      };

      if (isOnrampTxnRef(txnRef)) {
        const onramp = await repos.onramp.findOnrampByTxnRef(txnRef);
        if (!onramp) break;
        if (onramp.status !== 'CRYPTO_PENDING') break;

        await repos.onramp.updateOnrampStatus(onramp.id, 'COMPLETED', {
          receipt: {
            ...receipt,
            txnRef,
            transactionHash: typeof d.destination_tx_id === 'string' ? d.destination_tx_id : undefined,
            destinationTxId: d.destination_tx_id ?? undefined,
            awaitingWebhookConfirmation: false,
          },
          providerRefs: {
            webhookWithdrawSuccessful: { id: d._id, reference: d.reference },
          },
        });
        break;
      }

      if (isOfframpTxnRef(txnRef)) {
        const offramp = await repos.offramp.findOfframpByTxnRef(txnRef);
        if (!offramp) break;
        if (!['FIAT_PENDING', 'FIAT_INITIATED'].includes(offramp.status)) break;

        await repos.offramp.updateOfframpStatus(offramp.id, 'COMPLETED', {
          receipt: receipt as object,
          timeline: { completedAt: new Date().toISOString(), provider: 'palremit' } as object,
          lpReference: typeof d.reference === 'string' ? d.reference : txnRef,
          providerRefs: {
            webhookWithdrawSuccessful: { id: d._id, reference: d.reference },
          },
        });
        break;
      }
      break;
    }

    case 'withdraw.rejected': {
      const txnRef = requireTxnRef(d);
      if (!txnRef) break;

      const reason =
        typeof d.status_message === 'string' && d.status_message.trim() !== ''
          ? d.status_message.trim()
          : 'PALREMIT_WITHDRAW_REJECTED';

      if (isOnrampTxnRef(txnRef)) {
        const onramp = await repos.onramp.findOnrampByTxnRef(txnRef);
        if (!onramp) break;
        if (onramp.status !== 'CRYPTO_PENDING') break;

        await repos.onramp.updateOnrampStatus(onramp.id, 'CRYPTO_FAILED', {
          failedReason: reason,
          receipt: { provider: 'palremit', reference: d.reference, raw: d } as object,
          providerRefs: { webhookWithdrawRejected: { id: d._id } },
        });
        break;
      }

      if (isOfframpTxnRef(txnRef)) {
        const offramp = await repos.offramp.findOfframpByTxnRef(txnRef);
        if (!offramp) break;
        if (!['FIAT_PENDING', 'FIAT_INITIATED'].includes(offramp.status)) break;

        await repos.offramp.updateOfframpStatus(offramp.id, 'FAILED', {
          failedReason: reason,
          receipt: { provider: 'palremit', reference: d.reference, raw: d } as object,
          lpReference: typeof d.reference === 'string' ? d.reference : txnRef,
          providerRefs: { webhookWithdrawRejected: { id: d._id } },
        });
        break;
      }
      break;
    }

    case 'user.created':
    case 'user.status_updated':
      break;

    case 'kyb.status_updated':
    case 'kyb.approved':
    case 'kyb.rejected': {
      const userId =
        typeof d.userId === 'string' && d.userId.trim() !== '' ? d.userId.trim() : undefined;
      if (!userId) break;
      const kybStatus =
        (d.kybStatus as string) ||
        (eventType === 'kyb.approved' ? 'approved' : eventType === 'kyb.rejected' ? 'rejected' : undefined);
      const rails = (d.rails as string[] | undefined) ?? [];
      const approvedRails = eventType === 'kyb.approved' ? rails : undefined;
      const existing = await repos.user.findUserById(userId);
      if (existing) {
        if (kybStatus) {
          await repos.user.updateUser(userId, {
            kybStatus: toKybStatus(kybStatus),
            ...(approvedRails && approvedRails.length > 0 ? { approvedRails } : {}),
          });
        }
        if (rails.length > 0) {
          const status =
            eventType === 'kyb.rejected'
              ? 'rejected'
              : eventType === 'kyb.approved'
                ? 'approved'
                : kybStatus ?? 'under_review';
          await repos.user.updateKybRailStatuses(
            userId,
            rails.map((rail) => ({
              rail,
              status,
              approvedAt: eventType === 'kyb.approved' ? new Date() : undefined,
            }))
          );
        }
      }
      break;
    }

    case 'document.reviewed':
      break;

    case 'wallet.created':
    case 'wallet.updated':
    case 'wallet.deleted':
    case 'account.created':
    case 'account.updated':
    case 'account.deleted':
      break;

    case 'onramp.created':
      break;
    case 'onramp.awaiting_funds':
    case 'onramp.fiat_received':
    case 'onramp.fiat_processed':
    case 'onramp.crypto_initiated': {
      const onrampId =
        typeof d.onrampId === 'string' && d.onrampId.trim() !== '' ? d.onrampId.trim() : undefined;
      if (!onrampId) break;
      const existing = await repos.onramp.findOnrampById(onrampId);
      if (!existing) break;
      const nextStatus: OnrampStatus =
        eventType === 'onramp.awaiting_funds'
          ? 'AWAITING_FUNDS'
          : eventType === 'onramp.fiat_received'
            ? 'FIAT_PENDING'
            : eventType === 'onramp.fiat_processed'
              ? 'FIAT_PROCESSED'
              : 'CRYPTO_INITIATED';
      await repos.onramp.updateOnrampStatus(onrampId, nextStatus);
      break;
    }
    case 'onramp.completed': {
      const onrampId =
        typeof d.onrampId === 'string' && d.onrampId.trim() !== '' ? d.onrampId.trim() : undefined;
      if (!onrampId) break;
      const existing = await repos.onramp.findOnrampById(onrampId);
      if (existing) {
        const transactionHash = d.transactionHash as string | undefined;
        await repos.onramp.updateOnrampStatus(onrampId, 'COMPLETED', {
          receipt: transactionHash ? { transactionHash } : null,
        });
      }
      break;
    }
    case 'onramp.failed': {
      const onrampId =
        typeof d.onrampId === 'string' && d.onrampId.trim() !== '' ? d.onrampId.trim() : undefined;
      if (!onrampId) break;
      const existing = await repos.onramp.findOnrampById(onrampId);
      if (existing) {
        const failedReason = (d.failedReason ?? d.failureReason) as string | undefined;
        await repos.onramp.updateOnrampStatus(onrampId, 'CRYPTO_FAILED', {
          failedReason: failedReason ?? 'LP reported failure',
        });
      }
      break;
    }

    case 'offramp.created':
      break;
    case 'offramp.crypto_received': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        const timeline = { cryptoReceivedAt: new Date().toISOString() };
        const receipt = d.transactionHash ? { transactionHash: d.transactionHash as string } : undefined;
        await repos.offramp.updateOfframpStatus(offrampId, 'CRYPTO_PENDING', {
          timeline: timeline as object,
          receipt: receipt ?? null,
        });
      }
      break;
    }
    case 'offramp.crypto_confirmed': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'CRYPTO_CONFIRMED');
      }
      break;
    }
    case 'offramp.fee_processed': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'FEE_PROCESSED');
      }
      break;
    }
    case 'offramp.fiat_initiated': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'FIAT_INITIATED', {
          timeline: { fiatInitiatedAt: new Date().toISOString() } as object,
        });
      }
      break;
    }
    case 'offramp.completed': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'COMPLETED', {
          timeline: { completedAt: new Date().toISOString() } as object,
        });
      }
      break;
    }
    case 'offramp.failed': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        const failedReason = (d.failureReason ?? d.failedReason) as string | undefined;
        await repos.offramp.updateOfframpStatus(offrampId, 'FAILED', {
          failedReason: failedReason ?? 'LP reported failure',
        });
      }
      break;
    }
    case 'offramp.cancelled': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'CANCELLED', {
          timeline: { cancelledAt: new Date().toISOString() } as object,
        });
      }
      break;
    }
    case 'offramp.refunded': {
      const offrampId =
        typeof d.offrampId === 'string' && d.offrampId.trim() !== '' ? d.offrampId.trim() : undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'REFUNDED', {
          refundDetails: {
            status: (d.refundStatus as string) ?? 'refunded',
            refundedAt: new Date().toISOString(),
            transactionHash: (d.refundTransactionHash as string) ?? undefined,
            currency: (d.refundCurrency as string) ?? undefined,
            amount: (d.refundAmount as string) ?? undefined,
          } as object,
        });
      }
      break;
    }

    case 'limit.reached':
      break;
    case 'high_value_request.approved': {
      const id =
        (typeof d.requestId === 'string' && d.requestId.trim() !== '' ? d.requestId.trim() : undefined) ??
        (typeof d.highValueRequestId === 'string' && d.highValueRequestId.trim() !== ''
          ? d.highValueRequestId.trim()
          : undefined) ??
        (typeof d.id === 'string' && d.id.trim() !== '' ? d.id.trim() : undefined);
      if (!id) break;
      const row =
        (await repos.highValueRequest.findHighValueRequestById(id).catch(() => null)) ??
        (await repos.highValueRequest.findHighValueRequestByRequestId(id).catch(() => null));
      if (row) await repos.highValueRequest.updateHighValueRequestStatus(row.id, 'approved');
      break;
    }
    case 'high_value_request.rejected': {
      const id =
        (typeof d.requestId === 'string' && d.requestId.trim() !== '' ? d.requestId.trim() : undefined) ??
        (typeof d.highValueRequestId === 'string' && d.highValueRequestId.trim() !== ''
          ? d.highValueRequestId.trim()
          : undefined) ??
        (typeof d.id === 'string' && d.id.trim() !== '' ? d.id.trim() : undefined);
      if (!id) break;
      const row =
        (await repos.highValueRequest.findHighValueRequestById(id).catch(() => null)) ??
        (await repos.highValueRequest.findHighValueRequestByRequestId(id).catch(() => null));
      if (row) await repos.highValueRequest.updateHighValueRequestStatus(row.id, 'rejected');
      break;
    }

    default:
      break;
  }
}
