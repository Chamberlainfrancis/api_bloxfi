/**
 * Offramp repository. Only layer that touches Prisma for Offramp.
 * Per CURSOR_RULES: all DB access for offramps goes through this file.
 */

import { prisma } from '@/db/prisma/client';
import type { OfframpStatus } from '@/types/offramp';
import { mapOfframpStatusToEvent, schedulePartnerWebhook } from '@/core/partnerWebhooks';
import { shouldEmitRampEvent } from '@/core/partnerWebhooks/rampTransition';
import { blocksOfframpTransition, heldFailureRecord } from '@/core/ramps/fundsReceivedGuard';
import { logger } from '@/lib/logger';
import { senderNameFromRow } from '@/core/offramps/senderName';
import { redactProviderNamesFromClientMessage } from '@/utils/redactProviderNames';
import {
  finalizeWalletOfframp,
  inWalletTx,
  reserveForOfframp,
  toDecimal,
  type WalletAsset,
  type WalletFundingInfo,
} from '@/db/repositories/businessWallet.repo';

const STATUS_VALUES = [
  'CREATED',
  'AWAITING_CRYPTO',
  'CRYPTO_PENDING',
  'CRYPTO_RECEIVED',
  'CRYPTO_CONFIRMED',
  'PROCESSING_FEE',
  'FEE_PROCESSED',
  'FIAT_INITIATED',
  'FIAT_PENDING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'CRYPTO_FAILED',
  'FIAT_FAILED',
  'EXPIRED',
] as const;

function toPrismaStatus(s: OfframpStatus): (typeof STATUS_VALUES)[number] {
  if (STATUS_VALUES.includes(s as (typeof STATUS_VALUES)[number])) {
    return s as (typeof STATUS_VALUES)[number];
  }
  return 'CREATED';
}

export interface CreateOfframpData {
  requestId: string;
  txnRef: string;
  providerRefs?: object | null;
  userId: string;
  status: OfframpStatus;
  source: object;
  destination: object;
  rateInformation: object;
  depositInstructions?: object | null;
  timeline?: object | null;
  fees?: object | null;
  profit?: object | null;
  receipt?: object | null;
  refundDetails?: object | null;
  failedReason?: string | null;
  lpReference?: string | null;
}

export interface OfframpRow {
  id: string;
  requestId: string;
  txnRef: string | null;
  providerRefs: unknown;
  userId: string;
  status: string;
  source: unknown;
  destination: unknown;
  rateInformation: unknown;
  depositInstructions: unknown;
  timeline: unknown;
  fees: unknown;
  receipt: unknown;
  refundDetails: unknown;
  failedReason: string | null;
  lpReference: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function offrampWebhookData(row: OfframpRow) {
  const receipt = row.receipt != null && typeof row.receipt === 'object' && !Array.isArray(row.receipt)
    ? (row.receipt as Record<string, unknown>)
    : null;
  const hash = receipt && typeof receipt.transactionHash === 'string' ? receipt.transactionHash : undefined;
  const failedReason = row.failedReason
    ? redactProviderNamesFromClientMessage(row.failedReason)
    : undefined;
  return {
    offrampId: row.id,
    userId: row.userId,
    txnRef: row.txnRef,
    status: row.status,
    ...(failedReason ? { failedReason } : {}),
    ...(hash ? { transactionHash: hash } : {}),
    senderName: senderNameFromRow(row.providerRefs, receipt),
  };
}

function offrampCreateData(data: CreateOfframpData) {
  return {
    requestId: data.requestId,
    txnRef: data.txnRef,
    providerRefs: data.providerRefs === undefined || data.providerRefs === null ? undefined : (data.providerRefs as object),
    userId: data.userId,
    status: toPrismaStatus(data.status as OfframpStatus),
    source: data.source as object,
    destination: data.destination as object,
    rateInformation: data.rateInformation as object,
    depositInstructions: data.depositInstructions as object | undefined,
    timeline: data.timeline as object | undefined,
    fees: data.fees as object | undefined,
    profit: data.profit === undefined || data.profit === null ? undefined : (data.profit as object),
    receipt: data.receipt as object | undefined,
    refundDetails: data.refundDetails as object | undefined,
    failedReason: data.failedReason ?? null,
    lpReference: data.lpReference ?? null,
  };
}

export async function createOfframp(data: CreateOfframpData): Promise<OfframpRow> {
  const row = await prisma.offramp.create({ data: offrampCreateData(data) });
  const eventType = shouldEmitRampEvent(null, row.status, mapOfframpStatusToEvent);
  if (eventType) schedulePartnerWebhook(eventType, offrampWebhookData(row as OfframpRow));
  return row as OfframpRow;
}

/**
 * Wallet-funded offramp: the balance reserve and the offramp row are written
 * in one transaction, so there is never an offramp without its reserve or a
 * reserve without its offramp. Throws InsufficientWalletBalanceError /
 * WalletDebitsPausedError / WALLET_NOT_ENABLED (nothing written).
 */
export async function createWalletFundedOfframp(
  data: CreateOfframpData,
  funding: { asset: WalletAsset; amount: string }
): Promise<OfframpRow> {
  const row = await inWalletTx(async (tx) => {
    await reserveForOfframp(tx, {
      userId: data.userId,
      asset: funding.asset,
      amount: toDecimal(funding.amount),
      txnRef: data.txnRef,
    });
    return tx.offramp.create({ data: offrampCreateData(data) });
  });
  const eventType = shouldEmitRampEvent(null, row.status, mapOfframpStatusToEvent);
  if (eventType) schedulePartnerWebhook(eventType, offrampWebhookData(row as OfframpRow));
  return row as OfframpRow;
}

/** Wallet funding of an offramp row, or null when it was funded by deposit. */
export function walletFundingOf(row: { userId: string; txnRef: string | null; source: unknown }): WalletFundingInfo | null {
  const src = row.source != null && typeof row.source === 'object' && !Array.isArray(row.source) ? (row.source as Record<string, unknown>) : null;
  if (!src || src.fundingSource !== 'wallet' || !row.txnRef) return null;
  const asset = String(src.currency ?? '').toUpperCase();
  if (asset !== 'USDT' && asset !== 'USDC') return null;
  return { userId: row.userId, asset, amount: toDecimal(String(src.amount ?? '0')), txnRef: row.txnRef };
}

const WALLET_ENDINGS = new Set(['COMPLETED', 'CANCELLED', 'REFUNDED']);

export async function findOfframpById(id: string): Promise<OfframpRow | null> {
  const row = await prisma.offramp.findUnique({
    where: { id },
  });
  return row as OfframpRow | null;
}

export async function findOfframpByRequestId(requestId: string): Promise<OfframpRow | null> {
  const row = await prisma.offramp.findUnique({
    where: { requestId },
  });
  return row as OfframpRow | null;
}

export async function findOfframpByTxnRef(txnRef: string): Promise<OfframpRow | null> {
  const t = txnRef?.trim();
  if (!t) return null;
  const row = await prisma.offramp.findUnique({
    where: { txnRef: t },
  });
  return row as OfframpRow | null;
}

export async function updateOfframpStatus(
  id: string,
  status: OfframpStatus,
  updates?: {
    depositInstructions?: object | null;
    timeline?: object | null;
    fees?: object | null;
    receipt?: object | null;
    refundDetails?: object | null;
    failedReason?: string | null;
    lpReference?: string | null;
    providerRefs?: object | null;
  },
  options?: { emitPartnerWebhook?: boolean; allowAfterFunds?: boolean }
): Promise<OfframpRow | null> {
  const existing = await prisma.offramp.findUnique({ where: { id } });
  // We hold the customer's crypto: never fail/expire automatically. Keep the
  // current status and record what was attempted so ops can act on it.
  const held =
    !options?.allowAfterFunds &&
    blocksOfframpTransition(existing ? { status: String(existing.status), timeline: existing.timeline } : null, status);
  if (held) {
    logger.warn(
      { offrampId: id, currentStatus: existing?.status, attemptedStatus: status, reason: updates?.failedReason },
      'offramp failure refused: funds already received'
    );
  }
  const effectiveStatus = held && existing ? (String(existing.status) as OfframpStatus) : status;
  const providerRefsUpdate =
    held
      ? { ...((updates?.providerRefs as object | undefined) ?? {}), heldFailure: heldFailureRecord(status, updates?.failedReason) }
      : updates?.providerRefs;
  const mergedProviderRefs =
    providerRefsUpdate !== undefined && providerRefsUpdate !== null && existing
      ? ({
          ...((existing.providerRefs as object) ?? {}),
          ...(providerRefsUpdate as object),
        } as object)
      : undefined;

  const finalStatus = toPrismaStatus(effectiveStatus);
  const data = {
    status: finalStatus,
    ...(updates?.depositInstructions !== undefined && {
      depositInstructions: updates.depositInstructions as object | undefined,
    }),
    ...(updates?.timeline !== undefined && { timeline: updates.timeline as object | undefined }),
    ...(updates?.fees !== undefined && { fees: updates.fees as object | undefined }),
    ...(updates?.receipt !== undefined && { receipt: updates.receipt as object | undefined }),
    ...(updates?.refundDetails !== undefined && {
      refundDetails: updates.refundDetails as object | undefined,
    }),
    ...(!held && updates?.failedReason !== undefined && { failedReason: updates.failedReason }),
    ...(updates?.lpReference !== undefined && { lpReference: updates.lpReference }),
    ...(mergedProviderRefs !== undefined && { providerRefs: mergedProviderRefs }),
  };

  // Wallet-funded offramp reaching an ending: the status change and the
  // ledger entry (settle on COMPLETED, release on CANCELLED/REFUNDED) commit
  // together or not at all.
  const funding = existing ? walletFundingOf(existing) : null;
  const endsWallet = funding != null && WALLET_ENDINGS.has(finalStatus) && String(existing?.status) !== finalStatus;
  const row =
    endsWallet && funding
      ? await inWalletTx(async (tx) => {
          const updated = await tx.offramp.update({ where: { id }, data });
          await finalizeWalletOfframp(tx, funding, finalStatus as 'COMPLETED' | 'CANCELLED' | 'REFUNDED');
          return updated;
        })
      : await prisma.offramp.update({ where: { id }, data });
  const eventType = shouldEmitRampEvent(existing?.status ?? null, row.status, mapOfframpStatusToEvent);
  if (eventType && options?.emitPartnerWebhook !== false) {
    schedulePartnerWebhook(eventType, offrampWebhookData(row as OfframpRow));
  }
  return row as OfframpRow | null;
}

/** Offramps of this business still waiting for crypto at `address` (fiat-to-fiat pairing). */
export async function findOpenOfframpsByDepositAddress(
  userId: string,
  address: string
): Promise<OfframpRow[]> {
  const rows = await prisma.offramp.findMany({
    where: {
      userId,
      status: { in: ['AWAITING_CRYPTO', 'CRYPTO_PENDING'] },
      depositInstructions: { path: ['address'], equals: address },
    },
    orderBy: { createdAt: 'asc' },
  });
  return rows as OfframpRow[];
}

/**
 * Marks the offramp CRYPTO_CONFIRMED only while it is still in one of
 * `fromStatuses`, so two writers cannot both fund it. Emits the partner
 * webhook like updateOfframpStatus. Returns false when nothing was updated.
 */
export async function claimOfframpCrypto(
  id: string,
  fromStatuses: readonly OfframpStatus[],
  updates: { timeline: object; providerRefs: object; receipt: object }
): Promise<boolean> {
  const existing = await prisma.offramp.findUnique({ where: { id } });
  if (!existing || !fromStatuses.includes(String(existing.status) as OfframpStatus)) return false;
  const mergedProviderRefs = { ...((existing.providerRefs as object) ?? {}), ...updates.providerRefs };
  const res = await prisma.offramp.updateMany({
    where: { id, status: { in: fromStatuses.map(toPrismaStatus) } },
    data: {
      status: 'CRYPTO_CONFIRMED',
      timeline: updates.timeline,
      providerRefs: mergedProviderRefs,
      receipt: updates.receipt,
      failedReason: null,
    },
  });
  if (res.count !== 1) return false;
  const row = await prisma.offramp.findUnique({ where: { id } });
  const eventType = row ? shouldEmitRampEvent(existing.status, row.status, mapOfframpStatusToEvent) : null;
  if (row && eventType) schedulePartnerWebhook(eventType, offrampWebhookData(row as OfframpRow));
  return true;
}

export interface ListOfframpsParams {
  userId?: string;
  status?: OfframpStatus;
  excludeStatuses?: OfframpStatus[];
  currency?: string;
  limit: number;
  createdBefore?: Date;
  createdAfter?: Date;
}

export async function listOfframpsAwaitingDeposit(): Promise<OfframpRow[]> {
  const rows = await prisma.offramp.findMany({
    where: { status: 'AWAITING_CRYPTO' },
  });
  return rows as OfframpRow[];
}

export async function listOfframps(params: ListOfframpsParams): Promise<{
  offramps: OfframpRow[];
  nextCursor: Date | null;
}> {
  const { userId, status, excludeStatuses, currency, limit, createdBefore, createdAfter } = params;
  const take = Math.min(Math.max(1, limit), 100);
  const where: {
    userId?: string;
    status?: (typeof STATUS_VALUES)[number] | { notIn: (typeof STATUS_VALUES)[number][] };
    createdAt?: { lt?: Date; gt?: Date };
  } = {};

  if (userId) where.userId = userId;
  if (status) {
    where.status = toPrismaStatus(status);
  } else if (excludeStatuses?.length) {
    where.status = {
      notIn: excludeStatuses.map((s) => toPrismaStatus(s)),
    };
  }
  if (createdBefore || createdAfter) {
    where.createdAt = {};
    if (createdBefore) where.createdAt.lt = createdBefore;
    if (createdAfter) where.createdAt.gt = createdAfter;
  }

  let rows = await prisma.offramp.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: currency ? take * 3 : take + 1,
  });

  if (currency) {
    const lower = currency.toLowerCase();
    rows = rows.filter(
      (r: { source: unknown; destination: unknown }) =>
        (r.source as { currency?: string })?.currency?.toLowerCase() === lower ||
        (r.destination as { currency?: string })?.currency?.toLowerCase() === lower
    );
  }

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].createdAt : null;
  return {
    offramps: page as OfframpRow[],
    nextCursor,
  };
}

export async function findCompletedProfits(): Promise<Array<{ profit: unknown }>> {
  return prisma.offramp.findMany({ where: { status: 'COMPLETED' }, select: { profit: true } });
}

export async function listOfframpsFeeSettlementsForAdmin(params: {
  limit: number;
  createdBefore?: Date;
}): Promise<{
  offramps: OfframpRow[];
  nextCursor: Date | null;
}> {
  const take = Math.min(Math.max(1, params.limit), 100);
  const settlementStatuses = ['pending', 'processing', 'failed', 'skipped'] as const;
  const where: {
    status: 'COMPLETED';
    createdAt?: { lt: Date };
    OR: Array<{ fees: { path: string[]; equals: string } }>;
  } = {
    status: 'COMPLETED',
    OR: settlementStatuses.map((s) => ({
      fees: {
        path: ['platformFee', 'settlement', 'status'],
        equals: s,
      },
    })),
  };
  if (params.createdBefore) {
    where.createdAt = { lt: params.createdBefore };
  }

  const rows = await prisma.offramp.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: take + 1,
  });

  const hasMore = rows.length > take;
  const page = hasMore ? rows.slice(0, take) : rows;
  const nextCursor = hasMore && page.length > 0 ? page[page.length - 1].createdAt : null;
  return {
    offramps: page as OfframpRow[],
    nextCursor,
  };
}

/**
 * Offramps whose latest saved payout webhook says the provider failed it
 * (incl. failed after funding), not yet refunded. Admin refunds queue.
 */
export async function listOfframpsWithProviderFailure(limit: number): Promise<OfframpRow[]> {
  const take = Math.min(Math.max(1, limit), 500);
  const rows = await prisma.offramp.findMany({
    where: {
      status: { notIn: ['REFUNDED'] },
      OR: [
        { providerRefs: { path: ['palremitOrchestrator', 'withdrawalStatus'], equals: 'failed_after_funding' } },
        { providerRefs: { path: ['palremitOrchestrator', 'withdrawalStatus'], equals: 'failed' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    take,
  });
  return rows as OfframpRow[];
}

/** Most recently refunded offramps (admin refunds queue history). */
export async function listRecentlyRefundedOfframps(limit: number): Promise<OfframpRow[]> {
  const rows = await prisma.offramp.findMany({
    where: { status: 'REFUNDED' },
    orderBy: { updatedAt: 'desc' },
    take: Math.min(Math.max(1, limit), 100),
  });
  return rows as OfframpRow[];
}
