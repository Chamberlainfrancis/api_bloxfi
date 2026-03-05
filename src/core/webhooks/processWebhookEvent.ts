/**
 * Core: process inbound webhook events from LPs. Update state via repository interfaces.
 * Spec: user.*, kyb.*, document.reviewed; wallet.*; account.*; onramp.*; offramp.*; limit.*.
 * No Express/Prisma; receives repos via DI.
 */

import type { InboundWebhookPayload, WebhookEventType } from '../../types/webhook';
import type { OnrampStatus } from '../../types/onramp';
import type { OfframpStatus } from '../../types/offramp';
import type { KYBStatus } from '../../types/user';
import type { HighValueRequestStatus } from '../../types/limits';

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
    findOnrampById(id: string): Promise<{ id: string } | null>;
    updateOnrampStatus(
      id: string,
      status: OnrampStatus,
      updates?: { receipt?: object | null; failedReason?: string | null }
    ): Promise<unknown>;
  };
  offramp: {
    findOfframpById(id: string): Promise<{ id: string } | null>;
    updateOfframpStatus(
      id: string,
      status: OfframpStatus,
      updates?: {
        timeline?: object | null;
        receipt?: object | null;
        failedReason?: string | null;
        refundDetails?: object | null;
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
  CRYPTO_RECEIVED: 'CRYPTO_RECEIVED',
  FIAT_PENDING: 'FIAT_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
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
    case 'user.created':
    case 'user.status_updated':
      // User created/updated by LP – we own user creation; optional sync if needed
      break;

    case 'kyb.status_updated':
    case 'kyb.approved':
    case 'kyb.rejected': {
      const userId = d.userId as string | undefined;
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
    case 'onramp.completed': {
      const onrampId = d.onrampId as string | undefined;
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
      const onrampId = d.onrampId as string | undefined;
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
      const offrampId = d.offrampId as string | undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        const timeline = { cryptoReceivedAt: new Date().toISOString() };
        const receipt = d.transactionHash ? { transactionHash: d.transactionHash as string } : undefined;
        await repos.offramp.updateOfframpStatus(offrampId, 'CRYPTO_RECEIVED', {
          timeline: timeline as object,
          receipt: receipt ?? null,
        });
      }
      break;
    }
    case 'offramp.completed': {
      const offrampId = d.offrampId as string | undefined;
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
      const offrampId = d.offrampId as string | undefined;
      if (!offrampId) break;
      const existing = await repos.offramp.findOfframpById(offrampId);
      if (existing) {
        const failedReason = (d.failureReason ?? d.failedReason) as string | undefined;
        await repos.offramp.updateOfframpStatus(offrampId, 'FIAT_FAILED', {
          failedReason: failedReason ?? 'LP reported failure',
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
