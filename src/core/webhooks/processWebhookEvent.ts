/**
 * Core: process inbound webhook events from LPs / Palremit Liquidity Orchestrator.
 * Money-flow events: strict match on `client_reference` ↔ `txnRef` and `provisioned_account_id` ↔ stored id.
 * No Express/Prisma; receives repos via DI.
 */

import type { InboundWebhookPayload } from '@/types/webhook';
import type { OnrampStatus } from '@/types/onramp';
import type { OfframpStatus } from '@/types/offramp';
import type { KYBStatus } from '@/types/user';
import type { HighValueRequestStatus } from '@/types/limits';
import type { AccountDepositDetails, ProviderIssuanceStatus } from '@/types/account';
import { isOnrampTxnRef, isOfframpTxnRef, parseOfframpFeeClientReference } from '@/utils/txnRef';
import { logger } from '@/lib/logger';
import {
  beneficiaryDisplayNameFromOnrampSource,
  mapOrchestratorFiatInstructionsToDepositInfo,
} from '@/core/integrations/palremitOnramp';
import { mapCryptoInstructionsToDepositInstructions } from '@/core/integrations/palremitOfframp';
import type { PalremitDepositInstructions } from '@/core/integrations/palremitLiquidity';
import { depositDetailsFromInstructions } from '@/core/accounts/graphAccountIssuance';
import { schedulePartnerWebhook } from '@/core/partnerWebhooks';
import { redactProviderNamesFromClientMessage } from '@/utils/redactProviderNames';
import {
  expectedOfframpCryptoAmount,
  isOfframpCryptoDepositComplete,
  parseDepositWebhookAmount,
  priorCryptoReceivedAmount,
} from '@/core/offramps/offrampDepositAmount';

const ACCOUNT_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isAccountUuidClientRef(ref: string): boolean {
  return ACCOUNT_UUID_RE.test(ref);
}

export interface WebhookRepos {
  user: {
    findUserById(id: string): Promise<{ id: string; kybStatus?: string } | null>;
    updateUser(
      id: string,
      data: { kybStatus?: KYBStatus; approvedRails?: string[] }
    ): Promise<void>;
    updateKybRailStatuses(
      userId: string,
      updates: { rail: string; status: string; approvedAt?: Date }[]
    ): Promise<void>;
  };
  account?: {
    findAccountById(id: string): Promise<{
      id: string;
      userId: string;
      railType: string;
      provisionedAccountId: string | null;
      providerIssuanceStatus: string | null;
    } | null>;
    updateProviderIssuance(
      accountId: string,
      patch: {
        providerIssuanceStatus: string;
        provisionedAccountId?: string | null;
        depositDetails?: object | null;
        providerIssuanceFailureReason?: string | null;
      }
    ): Promise<unknown>;
  };
  onramp: {
    findOnrampById(id: string): Promise<{ id: string; status?: string } | null>;
    findOnrampByTxnRef(txnRef: string): Promise<{
      id: string;
      requestId: string;
      status: string;
      txnRef: string | null;
      providerRefs: unknown;
      source: unknown;
      quoteInformation: unknown;
    } | null>;
    updateOnrampStatus(
      id: string,
      status: OnrampStatus,
      updates?: {
        receipt?: object | null;
        failedReason?: string | null;
        providerRefs?: object | null;
        depositInfo?: object | null;
      }
    ): Promise<unknown>;
    advanceOnrampAfterFiatWebhook?(onrampId: string): Promise<void>;
  };
  offramp: {
    findOfframpById(id: string): Promise<{ id: string; status?: string } | null>;
    findOfframpByTxnRef(txnRef: string): Promise<{
      id: string;
      status: string;
      txnRef: string | null;
      providerRefs: unknown;
      source: unknown;
      depositInstructions: unknown;
      timeline: unknown;
      rateInformation: unknown;
    } | null>;
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
        depositInstructions?: object | null;
      }
    ): Promise<unknown>;
    advanceOfframpAfterCryptoWebhook?(offrampId: string): Promise<void>;
    /** Post-completion platform-fee settlement (fire-and-forget). */
    afterOfframpCompleted?(offrampId: string): void;
    applyPlatformFeeWithdrawalWebhook?(
      parentTxnRef: string,
      withdrawal: Record<string, unknown>,
      terminal: 'completed' | 'failed',
      failureNote?: string
    ): Promise<boolean>;
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

function getPalremitOrchestrator(providerRefs: unknown): Record<string, unknown> | null {
  if (providerRefs == null || typeof providerRefs !== 'object' || Array.isArray(providerRefs)) {
    return null;
  }
  const o = (providerRefs as Record<string, unknown>).palremitOrchestrator;
  if (o == null || typeof o !== 'object' || Array.isArray(o)) return null;
  return o as Record<string, unknown>;
}

/** Terminal onramp statuses — `withdrawal.successful` does not change these (except idempotent COMPLETED). */
const ONRAMP_TERMINAL_NO_COMPLETE = new Set<string>(['COMPLETED', 'EXPIRED']);

function withdrawalClientReference(
  withdrawal: Record<string, unknown>,
  data: Record<string, unknown>
): string {
  const fromWithdrawal =
    typeof withdrawal.client_reference === 'string' ? withdrawal.client_reference.trim() : '';
  if (fromWithdrawal) return fromWithdrawal;
  return typeof data.client_reference === 'string' ? data.client_reference.trim() : '';
}

async function applyFiatDepositAccountIssuanceWebhook(
  repos: WebhookRepos,
  params: {
    clientRef: string;
    provisionedAccountId: string;
    mode: string;
    status: ProviderIssuanceStatus;
    instructions?: PalremitDepositInstructions | null;
    failureReason?: string | null;
  }
): Promise<boolean> {
  if (!repos.account) return false;
  if (!params.mode.startsWith('FIAT_DEPOSIT')) return false;
  if (!isAccountUuidClientRef(params.clientRef)) return false;

  const row = await repos.account.findAccountById(params.clientRef);
  if (!row || row.railType !== 'onramp') return false;
  if (
    row.provisionedAccountId &&
    row.provisionedAccountId.trim() !== params.provisionedAccountId
  ) {
    return false;
  }

  let depositDetails: AccountDepositDetails | null = null;
  if (params.status === 'active' && params.instructions) {
    depositDetails = depositDetailsFromInstructions(params.instructions);
    if (!depositDetails) return false;
  }

  await repos.account.updateProviderIssuance(row.id, {
    providerIssuanceStatus: params.status,
    provisionedAccountId: params.provisionedAccountId,
    ...(params.status === 'active' ? { depositDetails, providerIssuanceFailureReason: null } : {}),
    ...(params.status === 'failed'
      ? {
          providerIssuanceFailureReason: params.failureReason ?? 'Identity verification could not be completed',
        }
      : {}),
    ...(params.status === 'pending' ? { providerIssuanceFailureReason: null } : {}),
  });
  return true;
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
    case 'deposit.credited': {
      const clientRef =
        typeof d.client_reference === 'string' ? d.client_reference.trim() : '';
      const depositObj = d.deposit;
      if (!clientRef || depositObj == null || typeof depositObj !== 'object' || Array.isArray(depositObj)) {
        break;
      }
      const dep = depositObj as Record<string, unknown>;
      const provId =
        typeof dep.provisioned_account_id === 'string' ? dep.provisioned_account_id.trim() : '';
      const depState = typeof dep.state === 'string' ? dep.state.toLowerCase() : '';
      const hasCreditedAt =
        typeof dep.credited_at === 'string' && dep.credited_at.trim() !== '';
      const depMode = typeof dep.mode === 'string' ? dep.mode : '';
      // LP payload uses `credited_at` on `deposit.credited`; `state` may be absent.
      if (!provId || !(depState === 'credited' || hasCreditedAt)) break;

      const assetObj = dep.asset;
      const assetCode =
        assetObj != null && typeof assetObj === 'object' && !Array.isArray(assetObj)
          ? String((assetObj as { code?: unknown }).code ?? '')
              .trim()
              .toUpperCase()
          : '';
      const depNetwork =
        typeof dep.network === 'string' && dep.network.trim() !== '' ? dep.network.trim() : '';

      if (isOnrampTxnRef(clientRef)) {
        const onramp = await repos.onramp.findOnrampByTxnRef(clientRef);
        if (!onramp) break;
        // Credit wins over deposit-window expiry: LP confirmed funds, so recover EXPIRED
        // (lazy GET/LIST or a prior late webhook may have marked the row expired).
        if (!['AWAITING_FUNDS', 'FIAT_PENDING', 'EXPIRED'].includes(onramp.status)) break;
        const orch = getPalremitOrchestrator(onramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== provId) break;
        if (!depMode.startsWith('FIAT_DEPOSIT')) break;
        const src = onramp.source as { currency?: string };
        const wantAsset = (src.currency ?? '').trim().toUpperCase();
        if (assetCode && wantAsset && assetCode !== wantAsset) break;

        const depId = typeof dep.id === 'string' ? dep.id.trim() : '';
        await repos.onramp.updateOnrampStatus(onramp.id, 'FIAT_PROCESSED', {
          failedReason: null,
          receipt: { provider: 'palremit', eventType, deposit: dep, client_reference: clientRef },
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              palremitDepositId: depId || undefined,
              depositStatus: 'credited',
              rawDepositCreditedPayload: d,
            },
          },
        });
        if (repos.onramp.advanceOnrampAfterFiatWebhook) {
          try {
            await repos.onramp.advanceOnrampAfterFiatWebhook(onramp.id);
          } catch (e) {
            logger.error({ onrampId: onramp.id, err: e }, 'webhooks advanceOnrampAfterFiatWebhook failed');
          }
        }
        break;
      }

      if (isOfframpTxnRef(clientRef)) {
        const offramp = await repos.offramp.findOfframpByTxnRef(clientRef);
        if (!offramp) break;
        // Credit wins over deposit-window expiry: LP confirmed funds, so recover EXPIRED
        // (lazy GET/LIST or a prior late webhook may have marked the row expired).
        if (!['AWAITING_CRYPTO', 'CRYPTO_PENDING', 'CRYPTO_RECEIVED', 'EXPIRED'].includes(offramp.status)) break;
        if (depMode !== 'CRYPTO_DEPOSIT') break;
        const orch = getPalremitOrchestrator(offramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== provId) break;
        const src = offramp.source as { currency?: string; chain?: string };
        if (assetCode && (src.currency ?? '').trim().toUpperCase() !== assetCode) break;
        const wantNet = (src.chain ?? '').trim().toUpperCase();
        if (depNetwork && wantNet && depNetwork.toUpperCase() !== wantNet) break;

        const incomingAmount = parseDepositWebhookAmount(dep);
        const expectedAmount = expectedOfframpCryptoAmount(offramp);
        if (incomingAmount == null || expectedAmount == null) {
          logger.warn(
            { offrampId: offramp.id, txnRef: clientRef, incomingAmount, expectedAmount },
            'offramp deposit.credited missing amount; skipping status update'
          );
          break;
        }

        const existingTimeline =
          offramp.timeline != null &&
          typeof offramp.timeline === 'object' &&
          !Array.isArray(offramp.timeline)
            ? (offramp.timeline as Record<string, unknown>)
            : {};
        const totalReceived = priorCryptoReceivedAmount(existingTimeline) + incomingAmount;
        const depositComplete = isOfframpCryptoDepositComplete(totalReceived, expectedAmount);
        const now = new Date().toISOString();

        const depId = typeof dep.id === 'string' ? dep.id.trim() : '';
        const nextStatus: OfframpStatus = depositComplete ? 'CRYPTO_CONFIRMED' : 'CRYPTO_RECEIVED';
        const nextTimeline: Record<string, unknown> = {
          ...existingTimeline,
          cryptoReceivedAmount: totalReceived,
          cryptoExpectedAmount: expectedAmount,
          lastDepositCreditedAt: now,
          ...(depositComplete
            ? { cryptoConfirmedAt: now }
            : { cryptoReceivedAt: existingTimeline.cryptoReceivedAt ?? now }),
        };

        await repos.offramp.updateOfframpStatus(offramp.id, nextStatus, {
          failedReason: null,
          receipt: { provider: 'palremit', eventType, deposit: dep, client_reference: clientRef },
          timeline: nextTimeline,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              palremitDepositId: depId || undefined,
              depositStatus: depositComplete ? 'credited' : 'partial',
              cryptoReceivedAmount: totalReceived,
              cryptoExpectedAmount: expectedAmount,
              rawDepositCreditedPayload: d,
            },
          },
        });

        if (depositComplete) {
          if (repos.offramp.advanceOfframpAfterCryptoWebhook) {
            try {
              await repos.offramp.advanceOfframpAfterCryptoWebhook(offramp.id);
            } catch (e) {
              logger.error({ offrampId: offramp.id, err: e }, 'webhooks advanceOfframpAfterCryptoWebhook failed');
            }
          }
        } else {
          logger.info(
            {
              offrampId: offramp.id,
              txnRef: clientRef,
              totalReceived,
              expectedAmount,
              incomingAmount,
            },
            'offramp partial crypto deposit; awaiting remaining funds before fiat payout'
          );
        }
      }
      break;
    }

    case 'withdrawal.successful': {
      const withdrawalObj = d.withdrawal;
      if (
        withdrawalObj == null ||
        typeof withdrawalObj !== 'object' ||
        Array.isArray(withdrawalObj)
      ) {
        break;
      }
      const w = withdrawalObj as Record<string, unknown>;
      const clientRef = withdrawalClientReference(w, d);
      const wstate = typeof w.state === 'string' ? w.state.toLowerCase() : '';
      const wmode = typeof w.mode === 'string' ? w.mode.trim() : '';
      if (!clientRef) break;
      if (wstate && wstate !== 'successful') break;

      const feeParentTxnRef = parseOfframpFeeClientReference(clientRef);
      if (feeParentTxnRef && repos.offramp.applyPlatformFeeWithdrawalWebhook) {
        const wmodeFee = wmode || 'CRYPTO_WITHDRAWAL';
        if (!wmodeFee || wmodeFee === 'CRYPTO_WITHDRAWAL') {
          await repos.offramp.applyPlatformFeeWithdrawalWebhook(feeParentTxnRef, w, 'completed');
        }
        break;
      }

      if (isOnrampTxnRef(clientRef)) {
        if (wmode && wmode !== 'CRYPTO_WITHDRAWAL') break;
        const onramp = await repos.onramp.findOnrampByTxnRef(clientRef);
        if (!onramp) break;
        if (ONRAMP_TERMINAL_NO_COMPLETE.has(onramp.status)) break;

        const orch = getPalremitOrchestrator(onramp.providerRefs);
        const wid = typeof w.id === 'string' ? w.id.trim() : '';
        const expectedWid =
          typeof orch?.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId.trim() : '';
        if (expectedWid && wid && expectedWid !== wid) break;

        const destTx =
          typeof w.provider_external_ref === 'string'
            ? w.provider_external_ref
            : typeof w.settlement_reference === 'string'
              ? w.settlement_reference
              : undefined;
        const completedAt = new Date().toISOString();

        await repos.onramp.updateOnrampStatus(onramp.id, 'COMPLETED', {
          failedReason: null,
          receipt: {
            provider: 'palremit',
            eventType,
            withdrawal: w,
            transactionHash: destTx,
            completedAt,
            ...(wid ? { palremitWithdrawalId: wid } : {}),
            awaitingWebhookConfirmation: false,
          },
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              ...(wid ? { palremitWithdrawalId: wid } : {}),
              withdrawalStatus: 'successful',
              completedAt,
              rawWithdrawalSuccessfulPayload: d,
            },
          },
        });
        break;
      }

      if (isOfframpTxnRef(clientRef)) {
        if (wmode !== 'FIAT_WITHDRAWAL') break;
        const offramp = await repos.offramp.findOfframpByTxnRef(clientRef);
        if (!offramp) break;
        // Include CRYPTO_CONFIRMED: fiat can succeed at LP while our row never reached FIAT_*
        // (e.g. advanceOfframpIfDepositReady returned early or LP lag vs DB).
        // Include FAILED/FIAT_FAILED so a late LP success webhook can recover a row
        // the operator marked failed while the withdrawal was still in flight.
        if (
          !['FIAT_PENDING', 'FIAT_INITIATED', 'CRYPTO_CONFIRMED', 'FAILED', 'FIAT_FAILED'].includes(
            offramp.status
          )
        ) {
          break;
        }
        const orch = getPalremitOrchestrator(offramp.providerRefs);
        // Only recover terminal failure rows the operator marked manually while the
        // LP withdrawal was still in flight — not genuine LP failures.
        if (['FAILED', 'FIAT_FAILED'].includes(offramp.status) && orch?.markedManually !== true) {
          break;
        }
        const wid = typeof w.id === 'string' ? w.id.trim() : '';
        const expectedWid =
          typeof orch?.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId.trim() : '';
        const timeline =
          offramp.timeline != null && typeof offramp.timeline === 'object' && !Array.isArray(offramp.timeline)
            ? (offramp.timeline as Record<string, unknown>)
            : {};
        const timelineWd =
          typeof timeline.fiatWithdrawalId === 'string' ? timeline.fiatWithdrawalId.trim() : '';
        const expectedFromDb = expectedWid || timelineWd;
        if (expectedFromDb && wid && expectedFromDb !== wid) break;

        await repos.offramp.updateOfframpStatus(offramp.id, 'COMPLETED', {
          failedReason: null,
          receipt: { provider: 'palremit', eventType, withdrawal: w } as object,
          timeline: {
            ...timeline,
            completedAt: new Date().toISOString(),
            fiatWithdrawalCompleted: true,
          } as object,
          lpReference: wid || clientRef,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              withdrawalStatus: 'successful',
              rawWithdrawalSuccessfulPayload: d,
            },
          },
        });
        repos.offramp.afterOfframpCompleted?.(offramp.id);
      }
      break;
    }

    case 'withdrawal.failed': {
      const withdrawalObj = d.withdrawal;
      if (
        withdrawalObj == null ||
        typeof withdrawalObj !== 'object' ||
        Array.isArray(withdrawalObj)
      ) {
        break;
      }
      const w = withdrawalObj as Record<string, unknown>;
      const clientRef =
        typeof w.client_reference === 'string' ? w.client_reference.trim() : '';
      const wstate = typeof w.state === 'string' ? w.state.toLowerCase() : '';
      const wmode = typeof w.mode === 'string' ? w.mode : '';
      if (!clientRef || wstate !== 'failed') break;

      const fail = w.failure_reason;
      const reason =
        fail != null &&
        typeof fail === 'object' &&
        !Array.isArray(fail) &&
        typeof (fail as { message?: unknown }).message === 'string' &&
        (fail as { message: string }).message.trim() !== ''
          ? (fail as { message: string }).message.trim()
          : 'PALREMIT_WITHDRAW_FAILED';

      const feeParentTxnRefFailed = parseOfframpFeeClientReference(clientRef);
      if (feeParentTxnRefFailed && repos.offramp.applyPlatformFeeWithdrawalWebhook) {
        const wmodeFee = wmode || 'CRYPTO_WITHDRAWAL';
        if (!wmodeFee || wmodeFee === 'CRYPTO_WITHDRAWAL') {
          await repos.offramp.applyPlatformFeeWithdrawalWebhook(
            feeParentTxnRefFailed,
            w,
            'failed',
            reason
          );
        }
        break;
      }

      if (isOnrampTxnRef(clientRef)) {
        if (wmode !== 'CRYPTO_WITHDRAWAL') break;
        const onramp = await repos.onramp.findOnrampByTxnRef(clientRef);
        if (!onramp) break;
        if (onramp.status !== 'CRYPTO_PENDING') break;
        const orch = getPalremitOrchestrator(onramp.providerRefs);
        const wid = typeof w.id === 'string' ? w.id.trim() : '';
        const expectedWid =
          typeof orch?.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId.trim() : '';
        if (expectedWid && wid && expectedWid !== wid) break;

        await repos.onramp.updateOnrampStatus(onramp.id, 'CRYPTO_FAILED', {
          failedReason: reason,
          receipt: { provider: 'palremit', eventType, withdrawal: w } as object,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              withdrawalStatus: 'failed',
              rawWithdrawalFailedPayload: d,
            },
          },
        });
        break;
      }

      if (isOfframpTxnRef(clientRef)) {
        if (wmode !== 'FIAT_WITHDRAWAL') break;
        const offramp = await repos.offramp.findOfframpByTxnRef(clientRef);
        if (!offramp) break;
        if (!['FIAT_PENDING', 'FIAT_INITIATED', 'CRYPTO_CONFIRMED'].includes(offramp.status)) break;
        const orch = getPalremitOrchestrator(offramp.providerRefs);
        const wid = typeof w.id === 'string' ? w.id.trim() : '';
        const expectedWid =
          typeof orch?.palremitWithdrawalId === 'string' ? orch.palremitWithdrawalId.trim() : '';
        const timeline =
          offramp.timeline != null && typeof offramp.timeline === 'object' && !Array.isArray(offramp.timeline)
            ? (offramp.timeline as Record<string, unknown>)
            : {};
        const timelineWd =
          typeof timeline.fiatWithdrawalId === 'string' ? timeline.fiatWithdrawalId.trim() : '';
        const expectedFromDb = expectedWid || timelineWd;
        if (expectedFromDb && wid && expectedFromDb !== wid) break;

        await repos.offramp.updateOfframpStatus(offramp.id, 'FAILED', {
          failedReason: reason,
          receipt: { provider: 'palremit', eventType, withdrawal: w } as object,
          lpReference: wid || clientRef,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              withdrawalStatus: 'failed',
              rawWithdrawalFailedPayload: d,
            },
          },
        });
      }
      break;
    }

    case 'provisioned_account.active': {
      const accountObj = d.account;
      if (accountObj == null || typeof accountObj !== 'object' || Array.isArray(accountObj)) {
        break;
      }
      const account = accountObj as Record<string, unknown>;
      const clientRef =
        typeof account.client_reference === 'string' ? account.client_reference.trim() : '';
      const accId = typeof account.id === 'string' ? account.id.trim() : '';
      const mode = typeof account.mode === 'string' ? account.mode : '';
      const accState = typeof account.state === 'string' ? account.state.toLowerCase() : '';
      if (!clientRef || !accId || accState !== 'active') break;

      const instrRaw = account.deposit_instructions;
      if (instrRaw == null || typeof instrRaw !== 'object' || Array.isArray(instrRaw)) break;
      const instructions = instrRaw as PalremitDepositInstructions;

      if (isOnrampTxnRef(clientRef) && mode.startsWith('FIAT_DEPOSIT')) {
        const onramp = await repos.onramp.findOnrampByTxnRef(clientRef);
        if (!onramp) break;
        if (!['AWAITING_FUNDS', 'FIAT_PENDING', 'CREATED'].includes(onramp.status)) break;
        const orch = getPalremitOrchestrator(onramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== accId) break;
        if (instructions.kind !== 'fiat_account') break;

        const qi = onramp.quoteInformation as { expiresAt?: string } | undefined;
        const depositByIso =
          (qi?.expiresAt && String(qi.expiresAt).trim()) ||
          new Date(Date.now() + 7 * 86400000).toISOString();
        const src = onramp.source as { currency?: string; amount?: number };
        const sourceCurrency = (src.currency ?? '').trim().toUpperCase() || 'FIAT';
        const preferredBeneficiary = beneficiaryDisplayNameFromOnrampSource(
          onramp.source,
          sourceCurrency
        );
        const depositInfo = mapOrchestratorFiatInstructionsToDepositInfo(
          instructions,
          onramp.requestId,
          depositByIso,
          typeof src.amount === 'number' ? src.amount : 0,
          sourceCurrency,
          preferredBeneficiary,
        );
        const nextStatus: OnrampStatus =
          onramp.status === 'CREATED' || onramp.status === 'FIAT_PENDING'
            ? 'AWAITING_FUNDS'
            : (onramp.status as OnrampStatus);
        await repos.onramp.updateOnrampStatus(onramp.id, nextStatus, {
          depositInfo: depositInfo as object,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              depositStatus: 'active',
              rawProvisionActivePayload: d,
            },
          },
        });
        break;
      }

      if (
        await applyFiatDepositAccountIssuanceWebhook(repos, {
          clientRef,
          provisionedAccountId: accId,
          mode,
          status: 'active',
          instructions,
        })
      ) {
        break;
      }

      if (isOfframpTxnRef(clientRef) && mode === 'CRYPTO_DEPOSIT') {
        const offramp = await repos.offramp.findOfframpByTxnRef(clientRef);
        if (!offramp) break;
        if (!['AWAITING_CRYPTO', 'CRYPTO_PENDING'].includes(offramp.status)) break;
        const orch = getPalremitOrchestrator(offramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== accId) break;
        if (instructions.kind !== 'crypto_address') break;

        const ri = offramp.rateInformation as { expiresAt?: string } | undefined;
        const prevDi =
          offramp.depositInstructions != null &&
          typeof offramp.depositInstructions === 'object' &&
          !Array.isArray(offramp.depositInstructions)
            ? (offramp.depositInstructions as { depositBy?: string })
            : undefined;
        const depositBy =
          (ri?.expiresAt && String(ri.expiresAt).trim()) ||
          (prevDi?.depositBy && String(prevDi.depositBy).trim()) ||
          new Date(Date.now() + 7 * 86400000).toISOString();
        const src = offramp.source as { amount?: number; currency?: string };
        const di = mapCryptoInstructionsToDepositInstructions(
          instructions,
          typeof src.amount === 'number' ? src.amount : 0,
          depositBy,
          (src.currency ?? '').trim().toUpperCase() || 'CRYPTO',
        );
        if (!di) break;
        await repos.offramp.updateOfframpStatus(offramp.id, 'AWAITING_CRYPTO', {
          depositInstructions: di as object,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              depositStatus: 'active',
              rawProvisionActivePayload: d,
            },
          },
        });
      }
      break;
    }

    case 'provisioned_account.kyc_pending': {
      const accountObj = d.account;
      if (accountObj == null || typeof accountObj !== 'object' || Array.isArray(accountObj)) {
        break;
      }
      const account = accountObj as Record<string, unknown>;
      const clientRef =
        typeof account.client_reference === 'string' ? account.client_reference.trim() : '';
      const accId = typeof account.id === 'string' ? account.id.trim() : '';
      const mode = typeof account.mode === 'string' ? account.mode : '';
      const accState = typeof account.state === 'string' ? account.state.toLowerCase() : '';
      if (!clientRef || !accId || accState !== 'kyc_pending') break;

      if (isOnrampTxnRef(clientRef) && mode.startsWith('FIAT_DEPOSIT')) {
        const onramp = await repos.onramp.findOnrampByTxnRef(clientRef);
        if (!onramp) break;
        if (!['AWAITING_FUNDS', 'FIAT_PENDING', 'CREATED'].includes(onramp.status)) break;
        const orch = getPalremitOrchestrator(onramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== accId) break;
        await repos.onramp.updateOnrampStatus(onramp.id, onramp.status as OnrampStatus, {
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              provisionState: 'kyc_pending',
              rawProvisionKycPendingPayload: d,
            },
          },
        });
        break;
      }

      if (
        await applyFiatDepositAccountIssuanceWebhook(repos, {
          clientRef,
          provisionedAccountId: accId,
          mode,
          status: 'pending',
        })
      ) {
        break;
      }

      if (isOfframpTxnRef(clientRef) && mode === 'CRYPTO_DEPOSIT') {
        const offramp = await repos.offramp.findOfframpByTxnRef(clientRef);
        if (!offramp) break;
        if (!['AWAITING_CRYPTO', 'CRYPTO_PENDING'].includes(offramp.status)) break;
        const orch = getPalremitOrchestrator(offramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== accId) break;
        await repos.offramp.updateOfframpStatus(offramp.id, offramp.status as OfframpStatus, {
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              provisionState: 'kyc_pending',
              rawProvisionKycPendingPayload: d,
            },
          },
        });
      }
      break;
    }

    case 'provisioned_account.failed': {
      const accountObj = d.account;
      if (accountObj == null || typeof accountObj !== 'object' || Array.isArray(accountObj)) {
        break;
      }
      const account = accountObj as Record<string, unknown>;
      const clientRef =
        typeof account.client_reference === 'string' ? account.client_reference.trim() : '';
      const accId = typeof account.id === 'string' ? account.id.trim() : '';
      const mode = typeof account.mode === 'string' ? account.mode : '';
      if (!clientRef || !accId) break;

      const rawMsg =
        account.failure_reason != null &&
        typeof account.failure_reason === 'object' &&
        !Array.isArray(account.failure_reason) &&
        typeof (account.failure_reason as { message?: unknown }).message === 'string'
          ? String((account.failure_reason as { message: string }).message).trim()
          : '';
      const msg = redactProviderNamesFromClientMessage(
        rawMsg || 'Identity verification could not be completed'
      );

      if (isOnrampTxnRef(clientRef) && mode.startsWith('FIAT_DEPOSIT')) {
        const onramp = await repos.onramp.findOnrampByTxnRef(clientRef);
        if (!onramp) break;
        const orch = getPalremitOrchestrator(onramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== accId) break;
        if (!['AWAITING_FUNDS', 'FIAT_PENDING', 'CREATED'].includes(onramp.status)) break;
        await repos.onramp.updateOnrampStatus(onramp.id, 'FIAT_FAILED', {
          failedReason: msg,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              depositStatus: 'failed',
              rawProvisionFailedPayload: d,
            },
          },
        });
        break;
      }

      if (
        await applyFiatDepositAccountIssuanceWebhook(repos, {
          clientRef,
          provisionedAccountId: accId,
          mode,
          status: 'failed',
          failureReason: msg,
        })
      ) {
        break;
      }

      if (isOfframpTxnRef(clientRef) && mode === 'CRYPTO_DEPOSIT') {
        const offramp = await repos.offramp.findOfframpByTxnRef(clientRef);
        if (!offramp) break;
        const orch = getPalremitOrchestrator(offramp.providerRefs);
        const expectedProv =
          typeof orch?.provisionedAccountId === 'string' ? orch.provisionedAccountId.trim() : '';
        if (!expectedProv || expectedProv !== accId) break;
        if (!['AWAITING_CRYPTO', 'CRYPTO_PENDING'].includes(offramp.status)) break;
        await repos.offramp.updateOfframpStatus(offramp.id, 'CRYPTO_FAILED', {
          failedReason: msg,
          providerRefs: {
            palremitOrchestrator: {
              ...(orch ?? {}),
              depositStatus: 'failed',
              rawProvisionFailedPayload: d,
            },
          },
        });
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
          const nextStatus = toKybStatus(kybStatus);
          await repos.user.updateUser(userId, {
            kybStatus: nextStatus,
            ...(approvedRails && approvedRails.length > 0 ? { approvedRails } : {}),
          });
          if (nextStatus !== existing.kybStatus) {
            schedulePartnerWebhook('kyb.status_updated', {
              userId,
              kybStatus: nextStatus,
              previousStatus: existing.kybStatus,
              ...(rails.length > 0 ? { rails } : {}),
            });
          }
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
        repos.offramp.afterOfframpCompleted?.(offrampId);
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
