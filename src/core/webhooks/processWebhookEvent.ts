/**
 * Core: process inbound webhook events from LPs / Palremit. Update state via repository interfaces.
 * BloxFi-shaped: user.*, kyb.*, onramp.*, offramp.*, …
 * Palremit §4 ramp webhooks are not used (partner flows use §5–§6 only).
 * No Express/Prisma; receives repos via DI.
 */

import type { InboundWebhookPayload } from '@/types/webhook';
import type { OnrampStatus } from '@/types/onramp';
import type { OfframpStatus } from '@/types/offramp';
import type { KYBStatus } from '@/types/user';
import type { HighValueRequestStatus } from '@/types/limits';

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
    findOnrampByReferenceMatch(ref: string): Promise<{ id: string; status: string } | null>;
    findOnrampByFiatReceiverAccountAndAmount?(params: {
      receiverAccount: string;
      amount: number;
      currency?: string;
    }): Promise<{ id: string; status: string } | null>;
    updateOnrampStatus(
      id: string,
      status: OnrampStatus,
      updates?: { receipt?: object | null; failedReason?: string | null }
    ): Promise<unknown>;
    /**
     * After NGN `deposit.successful` sets FIAT_PROCESSED, run Palremit crypto payout (same as GET /onramps/:id).
     * Optional so tests / non-Palremit webhooks skip I/O.
     */
    advanceOnrampAfterFiatWebhook?(onrampId: string): Promise<void>;
  };
  offramp: {
    findOfframpById(id: string): Promise<{ id: string; status?: string } | null>;
    findOfframpByReferenceMatch(ref: string): Promise<{ id: string; status: string } | null>;
    findOfframpByDepositAddress?(address: string): Promise<{ id: string; status: string } | null>;
    updateOfframpStatus(
      id: string,
      status: OfframpStatus,
      updates?: {
        timeline?: object | null;
        receipt?: object | null;
        failedReason?: string | null;
        refundDetails?: object | null;
        lpReference?: string | null;
      }
    ): Promise<unknown>;
  };
  highValueRequest: {
    findHighValueRequestById(id: string): Promise<{ id: string } | null>;
    findHighValueRequestByRequestId(requestId: string): Promise<{ id: string } | null>;
    updateHighValueRequestStatus(id: string, status: HighValueRequestStatus): Promise<unknown>;
  };
}

const ONRAMP_STATUS_MAP: Record<string, OnrampStatus> = {
  CREATED: 'CREATED',
  AWAITING_FUNDS: 'AWAITING_FUNDS',
  FIAT_PENDING: 'FIAT_PENDING',
  FIAT_PROCESSED: 'FIAT_PROCESSED',
  CRYPTO_INITIATED: 'CRYPTO_INITIATED',
  CRYPTO_PENDING: 'CRYPTO_PENDING',
  COMPLETED: 'COMPLETED',
  FIAT_FAILED: 'FIAT_FAILED',
  FIAT_RETURNED: 'FIAT_RETURNED',
  CRYPTO_FAILED: 'CRYPTO_FAILED',
  EXPIRED: 'EXPIRED',
};

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

function toOnrampStatus(s: string): OnrampStatus {
  return ONRAMP_STATUS_MAP[s] ?? 'CREATED';
}

function toOfframpStatus(s: string): OfframpStatus {
  return OFFRAMP_STATUS_MAP[s] ?? 'CREATED';
}

function pickString(d: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = d[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return undefined;
}

function toKybStatus(s: string): KYBStatus {
  const v = s?.toLowerCase();
  if (['not_started', 'incomplete', 'under_review', 'approved', 'rejected', 'suspended'].includes(v)) {
    return v as KYBStatus;
  }
  return 'under_review';
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
    /**
     * Palremit money-flow webhooks.
     * docs/palremit-webhook-ref.md:
     * - deposit.successful (crypto + NGN)
     * - withdraw.successful (crypto + NGN)
     * - withdraw.rejected (crypto + NGN)
     */
    case 'deposit.successful': {
      const currency = String(d.currency ?? '').trim().toUpperCase();
      if (!currency) break;

      // Fiat deposit is our onramp funding confirmation.
      if (currency === 'NGN') {
        const ref = pickString(d, ['reference', '_id']);
        const receiverAccount = pickString(d, ['receiver_account', 'reciever_account', 'receiverAccount']);
        const amountRaw = d.amount;
        const amountNum =
          typeof amountRaw === 'number'
            ? amountRaw
            : typeof amountRaw === 'string'
              ? Number(amountRaw)
              : NaN;

        let onramp: { id: string; status: string } | null = null;
        if (ref) {
          onramp = await repos.onramp.findOnrampByReferenceMatch(ref);
        }
        if (
          !onramp &&
          receiverAccount &&
          Number.isFinite(amountNum) &&
          repos.onramp.findOnrampByFiatReceiverAccountAndAmount
        ) {
          onramp = await repos.onramp.findOnrampByFiatReceiverAccountAndAmount({
            receiverAccount,
            amount: amountNum,
            currency: 'NGN',
          });
        }
        if (!onramp) break;
        await repos.onramp.updateOnrampStatus(onramp.id, 'FIAT_PROCESSED', {
          receipt: { provider: 'palremit', eventType, data: d },
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

      // Crypto deposit can be our offramp deposit funding confirmation.
      const destinationAddress = pickString(d, ['destination_address', 'destinationAddress']);
      if (!destinationAddress) break;
      if (!repos.offramp.findOfframpByDepositAddress) break;
      const offramp = await repos.offramp.findOfframpByDepositAddress(destinationAddress);
      if (!offramp) break;
      await repos.offramp.updateOfframpStatus(offramp.id, 'CRYPTO_CONFIRMED', {
        receipt: {
          provider: 'palremit',
          txId: d.tx_id ?? null,
          txLink: d.tx_link ?? null,
          confirmations: d.confirmations ?? null,
          currency,
          network: d.network ?? null,
          amount: d.amount ?? null,
          destinationAddress,
          raw: d,
        },
        timeline: { cryptoConfirmedAt: new Date().toISOString() } as object,
      });
      break;
    }

    case 'withdraw.successful': {
      const ref = pickString(d, ['reference', '_id']);
      if (!ref) break;

      const receipt = {
        provider: 'palremit',
        reference: ref,
        destinationTxId: d.destination_tx_id ?? null,
        destinationTxLink: d.destination_tx_link ?? null,
        raw: d,
      };

      const offramp = await repos.offramp.findOfframpByReferenceMatch(ref);
      if (offramp) {
        await repos.offramp.updateOfframpStatus(offramp.id, 'COMPLETED', {
          receipt: receipt as object,
          timeline: { completedAt: new Date().toISOString(), provider: 'palremit' } as object,
          lpReference: ref,
        });
        break;
      }

      const onramp = await repos.onramp.findOnrampByReferenceMatch(ref);
      if (onramp) {
        await repos.onramp.updateOnrampStatus(onramp.id, 'COMPLETED', {
          receipt: receipt as object,
        });
      }
      break;
    }

    case 'withdraw.rejected': {
      const ref = pickString(d, ['reference', '_id']);
      if (!ref) break;
      const reason = pickString(d, ['status_message', 'statusMessage']) ?? 'PALREMIT_WITHDRAW_REJECTED';

      const offramp = await repos.offramp.findOfframpByReferenceMatch(ref);
      if (offramp) {
        await repos.offramp.updateOfframpStatus(offramp.id, 'FAILED', {
          failedReason: reason,
          receipt: { provider: 'palremit', reference: ref, raw: d } as object,
          lpReference: ref,
        });
        break;
      }

      const onramp = await repos.onramp.findOnrampByReferenceMatch(ref);
      if (onramp) {
        await repos.onramp.updateOnrampStatus(onramp.id, 'CRYPTO_FAILED', {
          failedReason: reason,
          receipt: { provider: 'palremit', reference: ref, raw: d } as object,
        });
      }
      break;
    }

    case 'user.created':
    case 'user.status_updated':
      // User created/updated by LP – we own user creation; optional sync if needed
      break;

    case 'kyb.status_updated':
    case 'kyb.approved':
    case 'kyb.rejected': {
      const userId = pickString(d, ['userId', 'userld']);
      if (!userId) break;
      const kybStatus = (d.kybStatus as string) || (eventType === 'kyb.approved' ? 'approved' : eventType === 'kyb.rejected' ? 'rejected' : undefined);
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
          const status = eventType === 'kyb.rejected' ? 'rejected' : eventType === 'kyb.approved' ? 'approved' : (kybStatus ?? 'under_review');
          await repos.user.updateKybRailStatuses(
            userId,
            rails.map((rail) => ({ rail, status, approvedAt: eventType === 'kyb.approved' ? new Date() : undefined }))
          );
        }
      }
      break;
    }

    case 'document.reviewed':
      // Document review outcome – could update KybDocument status if we have repo
      break;

    case 'wallet.created':
    case 'wallet.updated':
    case 'wallet.deleted':
    case 'account.created':
    case 'account.updated':
    case 'account.deleted':
      // LP-notified changes; we own wallet/account CRUD – optional sync
      break;

    case 'onramp.created':
      break;
    case 'onramp.awaiting_funds':
    case 'onramp.fiat_received':
    case 'onramp.fiat_processed':
    case 'onramp.crypto_initiated': {
      const onrampId = pickString(d, ['onrampId', 'onrampld']);
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
      const onrampId = pickString(d, ['onrampId', 'onrampld']);
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
      const onrampId = pickString(d, ['onrampId', 'onrampld']);
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
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
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
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'CRYPTO_CONFIRMED');
      }
      break;
    }
    case 'offramp.fee_processed': {
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        await repos.offramp.updateOfframpStatus(offrampId, 'FEE_PROCESSED');
      }
      break;
    }
    case 'offramp.fiat_initiated': {
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
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
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
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
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
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
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
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
      const offrampId = pickString(d, ['offrampId', 'offrampld']);
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
      const id = (d.requestId ?? d.highValueRequestId ?? d.id) as string | undefined;
      if (!id) break;
      const row = await repos.highValueRequest.findHighValueRequestById(id).catch(() => null)
        ?? await repos.highValueRequest.findHighValueRequestByRequestId(id).catch(() => null);
      if (row) await repos.highValueRequest.updateHighValueRequestStatus(row.id, 'approved');
      break;
    }
    case 'high_value_request.rejected': {
      const id = (d.requestId ?? d.highValueRequestId ?? d.id) as string | undefined;
      if (!id) break;
      const row = await repos.highValueRequest.findHighValueRequestById(id).catch(() => null)
        ?? await repos.highValueRequest.findHighValueRequestByRequestId(id).catch(() => null);
      if (row) await repos.highValueRequest.updateHighValueRequestStatus(row.id, 'rejected');
      break;
    }

    default:
      // Unknown eventType – no-op
      break;
  }
}
