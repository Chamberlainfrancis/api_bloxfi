/**
 * Business wallet repository: the only layer that touches Prisma for the
 * wallet tables. Every balance change goes through `postJournal`, inside a
 * DB transaction, so a ledger journal, its postings and the cached balance
 * commit together or not at all.
 *
 * Integrity (also enforced by the database, see migration 20261119090000):
 * - One journal per idempotency key (unique index): a replayed webhook or a
 *   retried request posts nothing the second time.
 * - The balance row is locked (SELECT … FOR UPDATE) before it is read, so
 *   concurrent debits on one business + asset run one after the other.
 * - Balances can't go negative (CHECK), postings of a journal sum to zero
 *   and the cached balance equals the ledger (deferred constraint triggers),
 *   ledger rows can't be updated or deleted (triggers).
 */

import { generateWalletWithdrawalRef } from '@/core/businessWallets/refs';
import { canonicalWalletChain, normalizeWalletAddress } from '@/core/businessWallets/chains';
import { prisma } from '@/db/prisma/client';
import { Prisma } from '@/generated/prisma/client';
import { logger } from '@/lib/logger';

type Tx = Prisma.TransactionClient;
const Decimal = Prisma.Decimal;
type Decimal = Prisma.Decimal;

export type WalletAsset = 'USDT' | 'USDC';
export const WALLET_ASSETS: readonly WalletAsset[] = ['USDT', 'USDC'];

export type WalletAccount =
  | 'available'
  | 'reserved'
  | 'external:deposit'
  | 'external:offramp'
  | 'external:withdrawal'
  | 'adjustment';

export type JournalType =
  | 'deposit_credit'
  | 'offramp_reserve'
  | 'offramp_release'
  | 'offramp_settle'
  | 'offramp_refund'
  | 'withdrawal_reserve'
  | 'withdrawal_release'
  | 'withdrawal_settle'
  | 'adjustment';

export interface Posting {
  account: WalletAccount;
  /** Signed. Positive raises the account. */
  amount: Decimal;
}

export interface PostJournalInput {
  idempotencyKey: string;
  userId: string;
  asset: WalletAsset;
  type: JournalType;
  amount: Decimal;
  postings: Posting[];
  refType?: string | null;
  refId?: string | null;
  actor: string;
  note?: string | null;
}

export interface PostJournalResult {
  journalId: string;
  /** false when the key was already posted (nothing changed). */
  posted: boolean;
  available: string;
  reserved: string;
}

export class InsufficientWalletBalanceError extends Error {
  constructor(
    readonly asset: string,
    readonly available: string,
    readonly required: string
  ) {
    super('INSUFFICIENT_WALLET_BALANCE');
  }
}

export class WalletDebitsPausedError extends Error {
  constructor(readonly reason: string | null) {
    super('WALLET_DEBITS_PAUSED');
  }
}

export function toDecimal(v: Decimal | string | number): Decimal {
  const d = new Decimal(v as never);
  if (!d.isFinite()) throw new Error(`invalid amount: ${String(v)}`);
  return d;
}

function assertAsset(asset: string): WalletAsset {
  const a = asset.trim().toUpperCase();
  if (a !== 'USDT' && a !== 'USDC') throw new Error(`unsupported wallet asset: ${asset}`);
  return a;
}

/** Locks (creating if needed) the balance row and returns it. Must run inside a transaction. */
async function lockBalance(tx: Tx, userId: string, asset: WalletAsset): Promise<{ available: Decimal; reserved: Decimal }> {
  await tx.$executeRaw`
    INSERT INTO "WalletBalance" ("userId", "asset", "available", "reserved", "updatedAt")
    VALUES (${userId}, ${asset}, 0, 0, NOW())
    ON CONFLICT ("userId", "asset") DO NOTHING`;
  const rows = await tx.$queryRaw<Array<{ available: Decimal; reserved: Decimal }>>`
    SELECT "available", "reserved" FROM "WalletBalance"
    WHERE "userId" = ${userId} AND "asset" = ${asset}
    FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new Error('wallet balance row missing after upsert');
  return { available: new Decimal(row.available), reserved: new Decimal(row.reserved) };
}

/**
 * Post one balanced journal. Locks the balance first, then checks the key:
 * a second post of the same key (a replay, or a racing request that waited
 * on the lock) returns the first one and changes nothing.
 */
export async function postJournal(tx: Tx, input: PostJournalInput): Promise<PostJournalResult> {
  const asset = assertAsset(input.asset);
  if (!input.amount.isPositive() || input.amount.isZero()) throw new Error('journal amount must be positive');
  if (input.postings.length < 2) throw new Error('a journal needs at least two postings');
  const sum = input.postings.reduce((s, p) => s.plus(p.amount), new Decimal(0));
  if (!sum.isZero()) throw new Error(`journal ${input.idempotencyKey} does not balance (${sum.toString()})`);
  if (input.postings.some((p) => p.amount.isZero())) throw new Error('zero posting');

  const balance = await lockBalance(tx, input.userId, asset);
  const existing = await tx.walletJournal.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.userId !== input.userId || existing.asset !== asset || !new Decimal(existing.amount).equals(input.amount)) {
      throw new Error(`idempotency key ${input.idempotencyKey} already used for a different movement`);
    }
    return { journalId: existing.id, posted: false, available: balance.available.toString(), reserved: balance.reserved.toString() };
  }

  const delta = (acct: WalletAccount) =>
    input.postings.filter((p) => p.account === acct).reduce((s, p) => s.plus(p.amount), new Decimal(0));
  const available = balance.available.plus(delta('available'));
  const reserved = balance.reserved.plus(delta('reserved'));
  if (available.isNegative()) throw new InsufficientWalletBalanceError(asset, balance.available.toString(), delta('available').negated().toString());
  if (reserved.isNegative()) throw new Error(`reserved balance would go negative on ${input.idempotencyKey}`);

  const journal = await tx.walletJournal.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      userId: input.userId,
      asset,
      type: input.type,
      amount: input.amount,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      actor: input.actor,
      note: input.note ?? null,
    },
  });
  await tx.walletLedgerEntry.createMany({
    data: input.postings.map((p) => ({
      journalId: journal.id,
      userId: input.userId,
      asset,
      account: p.account,
      amount: p.amount,
    })),
  });
  await tx.walletBalance.update({
    where: { userId_asset: { userId: input.userId, asset } },
    data: { available, reserved },
  });
  return { journalId: journal.id, posted: true, available: available.toString(), reserved: reserved.toString() };
}

/** Postings for each kind of movement (amount > 0). */
export const postingsFor = {
  depositCredit: (a: Decimal): Posting[] => [
    { account: 'external:deposit', amount: a.negated() },
    { account: 'available', amount: a },
  ],
  reserve: (a: Decimal): Posting[] => [
    { account: 'available', amount: a.negated() },
    { account: 'reserved', amount: a },
  ],
  release: (a: Decimal): Posting[] => [
    { account: 'reserved', amount: a.negated() },
    { account: 'available', amount: a },
  ],
  settle: (a: Decimal, to: 'external:offramp' | 'external:withdrawal'): Posting[] => [
    { account: 'reserved', amount: a.negated() },
    { account: to, amount: a },
  ],
  refundAfterSettle: (a: Decimal): Posting[] => [
    { account: 'external:offramp', amount: a.negated() },
    { account: 'available', amount: a },
  ],
  adjustment: (signed: Decimal): Posting[] => [
    { account: 'adjustment', amount: signed.negated() },
    { account: 'available', amount: signed },
  ],
};

/** Run `fn` in one serializable-enough transaction (row locks do the ordering). */
export function inWalletTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn, { timeout: 15_000, maxWait: 10_000 });
}

// --- Settings ---------------------------------------------------------------

export interface BusinessWalletRow {
  id: string;
  userId: string;
  enabled: boolean;
  walletOnly: boolean;
  whitelistRequired: boolean;
  debitsPaused: boolean;
  pausedReason: string | null;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function findBusinessWallet(userId: string, tx: Tx = prisma): Promise<BusinessWalletRow | null> {
  return tx.businessWallet.findUnique({ where: { userId } });
}

export async function upsertBusinessWallet(
  userId: string,
  patch: Partial<Pick<BusinessWalletRow, 'enabled' | 'walletOnly' | 'whitelistRequired' | 'debitsPaused' | 'pausedReason'>>,
  updatedBy: string
): Promise<BusinessWalletRow> {
  return prisma.businessWallet.upsert({
    where: { userId },
    create: { userId, ...patch, updatedBy },
    update: { ...patch, updatedBy },
  });
}

export async function listBusinessWallets(): Promise<BusinessWalletRow[]> {
  return prisma.businessWallet.findMany({ orderBy: { createdAt: 'desc' } });
}

// --- Deposit addresses ------------------------------------------------------

export interface WalletDepositAddressRow {
  id: string;
  userId: string;
  asset: string;
  chain: string;
  address: string | null;
  memo: string | null;
  provisionedAccountId: string | null;
  clientReference: string;
  status: string;
  failureReason: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export async function listDepositAddresses(userId: string): Promise<WalletDepositAddressRow[]> {
  return prisma.walletDepositAddress.findMany({ where: { userId }, orderBy: [{ asset: 'asc' }, { chain: 'asc' }] });
}

export async function findDepositAddressByProvisionedAccount(provisionedAccountId: string): Promise<WalletDepositAddressRow | null> {
  return prisma.walletDepositAddress.findUnique({ where: { provisionedAccountId } });
}

export async function upsertDepositAddress(data: {
  userId: string;
  asset: string;
  chain: string;
  clientReference: string;
  status: string;
  address?: string | null;
  memo?: string | null;
  provisionedAccountId?: string | null;
  failureReason?: string | null;
  createdBy?: string | null;
}): Promise<WalletDepositAddressRow> {
  const { userId, asset, chain, ...rest } = data;
  return prisma.walletDepositAddress.upsert({
    where: { userId_asset_chain: { userId, asset, chain } },
    create: { userId, asset, chain, ...rest },
    update: rest,
  });
}

// --- Whitelist --------------------------------------------------------------

export interface WhitelistRow {
  id: string;
  userId: string;
  chain: string;
  address: string;
  label: string | null;
  addedBy: string;
  reason: string | null;
  createdAt: Date;
  removedAt: Date | null;
  removedBy: string | null;
}

export async function listWhitelist(userId: string, includeRemoved = false): Promise<WhitelistRow[]> {
  return prisma.walletWhitelistAddress.findMany({
    where: { userId, ...(includeRemoved ? {} : { removedAt: null }) },
    orderBy: { createdAt: 'desc' },
  });
}

export async function addWhitelistAddress(data: {
  userId: string;
  chain: string;
  address: string;
  label?: string | null;
  addedBy: string;
  reason?: string | null;
}): Promise<WhitelistRow> {
  const existing = await prisma.walletWhitelistAddress.findFirst({
    where: { userId: data.userId, chain: data.chain, address: data.address, removedAt: null },
  });
  if (existing) return existing;
  return prisma.walletWhitelistAddress.create({ data });
}

export async function removeWhitelistAddress(id: string, userId: string, removedBy: string): Promise<WhitelistRow | null> {
  const res = await prisma.walletWhitelistAddress.updateMany({
    where: { id, userId, removedAt: null },
    data: { removedAt: new Date(), removedBy },
  });
  if (res.count === 0) return null;
  return prisma.walletWhitelistAddress.findUnique({ where: { id } });
}

export async function isWhitelisted(userId: string, chain: string, address: string, tx: Tx = prisma): Promise<boolean> {
  const row = await tx.walletWhitelistAddress.findFirst({ where: { userId, chain, address, removedAt: null } });
  return row != null;
}

/**
 * Where a withdrawal may go: an admin-whitelisted address, or one of the
 * business's own active registered external wallets on the same chain
 * (Emmanuel, 19 Nov 2026). Deposit crediting uses the admin whitelist only.
 */
export async function isAllowedWithdrawalDestination(userId: string, chain: string, address: string, tx: Tx = prisma): Promise<boolean> {
  if (await isWhitelisted(userId, chain, address, tx)) return true;
  const code = chain.trim().toUpperCase();
  const registered = await tx.externalWallet.findMany({ where: { userId, active: true }, select: { chain: true, address: true } });
  return registered.some(
    (w) => canonicalWalletChain(w.chain) === code && normalizeWalletAddress(code, w.address) === address
  );
}

/** Active registered external wallets usable as withdrawal destinations (chain mapped to a network code). */
export async function listRegisteredWithdrawalWallets(
  userId: string
): Promise<Array<{ id: string; chain: string; address: string; label: string; createdAt: Date }>> {
  const rows = await prisma.externalWallet.findMany({ where: { userId, active: true }, orderBy: { createdAt: 'asc' } });
  return rows.flatMap((w) => {
    const chain = canonicalWalletChain(w.chain);
    const address = chain ? normalizeWalletAddress(chain, w.address) : null;
    return chain && address ? [{ id: w.id, chain, address, label: w.name, createdAt: w.createdAt }] : [];
  });
}

// --- Deposits -----------------------------------------------------------------

export interface WalletDepositRow {
  id: string;
  orchestratorDepositId: string;
  userId: string;
  asset: string;
  chain: string;
  amount: Decimal;
  address: string;
  senderAddress: string | null;
  txId: string | null;
  status: string;
  quarantineReason: string | null;
  journalId: string | null;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface IncomingWalletDeposit {
  orchestratorDepositId: string;
  userId: string;
  asset: WalletAsset;
  chain: string;
  amount: Decimal;
  address: string;
  senderAddress: string | null;
  txId: string | null;
  rawPayload?: unknown;
}

/**
 * Record a deposit and, when `credit` is true, credit it — in one
 * transaction. A deposit already recorded is returned unchanged (webhook
 * replays), so a deposit is credited at most once.
 */
export async function recordWalletDeposit(
  dep: IncomingWalletDeposit,
  decision: { credit: true } | { credit: false; reason: string }
): Promise<{ row: WalletDepositRow; created: boolean; credited: boolean }> {
  return inWalletTx(async (tx) => {
    // Lock first: concurrent deliveries of one deposit queue here, and the
    // later ones find the row the first one wrote.
    await lockBalance(tx, dep.userId, dep.asset);
    const prior = await tx.walletDeposit.findUnique({ where: { orchestratorDepositId: dep.orchestratorDepositId } });
    if (prior) return { row: prior as WalletDepositRow, created: false, credited: false };
    let journalId: string | null = null;
    if (decision.credit) {
      const j = await postJournal(tx, {
        idempotencyKey: `deposit:${dep.orchestratorDepositId}`,
        userId: dep.userId,
        asset: dep.asset,
        type: 'deposit_credit',
        amount: dep.amount,
        postings: postingsFor.depositCredit(dep.amount),
        refType: 'deposit',
        refId: dep.orchestratorDepositId,
        actor: 'system',
        note: dep.txId ? `tx ${dep.txId}` : null,
      });
      journalId = j.journalId;
    }
    const row = await tx.walletDeposit.create({
      data: {
        orchestratorDepositId: dep.orchestratorDepositId,
        userId: dep.userId,
        asset: dep.asset,
        chain: dep.chain,
        amount: dep.amount,
        address: dep.address,
        senderAddress: dep.senderAddress,
        txId: dep.txId,
        status: decision.credit ? 'credited' : 'quarantined',
        quarantineReason: decision.credit ? null : decision.reason,
        journalId,
        rawPayload: (dep.rawPayload ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
    return { row: row as WalletDepositRow, created: true, credited: decision.credit };
  });
}

/** Admin: credit a quarantined deposit (once). */
export async function creditQuarantinedDeposit(id: string, actor: string, note: string): Promise<WalletDepositRow> {
  return inWalletTx(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WalletDeposit" WHERE "id" = ${id} FOR UPDATE`;
    if (rows.length === 0) throw new Error('DEPOSIT_NOT_FOUND');
    const dep = await tx.walletDeposit.findUniqueOrThrow({ where: { id } });
    if (dep.status !== 'quarantined' && dep.status !== 'refund_pending') throw new Error('DEPOSIT_NOT_QUARANTINED');
    const amount = new Decimal(dep.amount);
    const j = await postJournal(tx, {
      idempotencyKey: `deposit:${dep.orchestratorDepositId}`,
      userId: dep.userId,
      asset: assertAsset(dep.asset),
      type: 'deposit_credit',
      amount,
      postings: postingsFor.depositCredit(amount),
      refType: 'deposit',
      refId: dep.orchestratorDepositId,
      actor,
      note: `quarantine released: ${note}`,
    });
    return (await tx.walletDeposit.update({
      where: { id },
      data: { status: 'credited_by_admin', journalId: j.journalId, resolvedBy: actor, resolvedAt: new Date(), resolutionNote: note },
    })) as WalletDepositRow;
  });
}

/** Admin: mark a quarantined deposit to be refunded by hand, then refunded. Never credits. */
export async function setQuarantinedDepositRefund(
  id: string,
  status: 'refund_pending' | 'refunded',
  actor: string,
  note: string
): Promise<WalletDepositRow> {
  const from = status === 'refund_pending' ? ['quarantined'] : ['quarantined', 'refund_pending'];
  const res = await prisma.walletDeposit.updateMany({
    where: { id, status: { in: from } },
    data: { status, resolvedBy: actor, resolvedAt: new Date(), resolutionNote: note },
  });
  if (res.count !== 1) throw new Error('DEPOSIT_NOT_QUARANTINED');
  return (await prisma.walletDeposit.findUniqueOrThrow({ where: { id } })) as WalletDepositRow;
}

export async function listWalletDeposits(params: { userId?: string; status?: string[]; limit?: number }): Promise<WalletDepositRow[]> {
  return (await prisma.walletDeposit.findMany({
    where: {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.status ? { status: { in: params.status } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(params.limit ?? 100, 500),
  })) as WalletDepositRow[];
}

// --- Balances and ledger reads ----------------------------------------------

export interface WalletBalanceView {
  asset: WalletAsset;
  available: string;
  reserved: string;
}

export async function getBalances(userId: string): Promise<WalletBalanceView[]> {
  const rows = await prisma.walletBalance.findMany({ where: { userId } });
  return WALLET_ASSETS.map((asset) => {
    const r = rows.find((x) => x.asset === asset);
    return {
      asset,
      available: r ? new Decimal(r.available).toString() : '0',
      reserved: r ? new Decimal(r.reserved).toString() : '0',
    };
  });
}

export interface JournalView {
  id: string;
  type: string;
  asset: string;
  amount: string;
  refType: string | null;
  refId: string | null;
  actor: string;
  note: string | null;
  availableDelta: string;
  reservedDelta: string;
  createdAt: Date;
}

export async function listJournals(params: {
  userId: string;
  asset?: string;
  types?: string[];
  limit?: number;
  before?: Date;
}): Promise<JournalView[]> {
  const rows = await prisma.walletJournal.findMany({
    where: {
      userId: params.userId,
      ...(params.asset ? { asset: params.asset.toUpperCase() } : {}),
      ...(params.types?.length ? { type: { in: params.types } } : {}),
      ...(params.before ? { createdAt: { lt: params.before } } : {}),
    },
    include: { entries: true },
    orderBy: { createdAt: 'desc' },
    take: Math.min(params.limit ?? 50, 200),
  });
  return rows.map((j) => {
    const sumOf = (acct: string) =>
      j.entries.filter((e) => e.account === acct).reduce((s, e) => s.plus(new Decimal(e.amount)), new Decimal(0));
    return {
      id: j.id,
      type: j.type,
      asset: j.asset,
      amount: new Decimal(j.amount).toString(),
      refType: j.refType,
      refId: j.refId,
      actor: j.actor,
      note: j.note,
      availableDelta: sumOf('available').toString(),
      reservedDelta: sumOf('reserved').toString(),
      createdAt: j.createdAt,
    };
  });
}

// --- Offramps -----------------------------------------------------------------

export function offrampReserveKey(txnRef: string): string {
  return `offramp:${txnRef}:reserve`;
}
/** Settle and release share one key: an offramp ends exactly one way. */
export function offrampFinalKey(txnRef: string): string {
  return `offramp:${txnRef}:final`;
}
export function offrampRefundKey(txnRef: string): string {
  return `offramp:${txnRef}:refund`;
}

/**
 * Reserve `amount` for an offramp inside the caller's transaction (the
 * offramp row is created in the same one). Throws
 * InsufficientWalletBalanceError / WalletDebitsPausedError.
 */
export async function reserveForOfframp(
  tx: Tx,
  input: { userId: string; asset: WalletAsset; amount: Decimal; txnRef: string }
): Promise<PostJournalResult> {
  const wallet = await tx.businessWallet.findUnique({ where: { userId: input.userId } });
  if (!wallet?.enabled) throw new Error('WALLET_NOT_ENABLED');
  if (wallet.debitsPaused) throw new WalletDebitsPausedError(wallet.pausedReason);
  return postJournal(tx, {
    idempotencyKey: offrampReserveKey(input.txnRef),
    userId: input.userId,
    asset: input.asset,
    type: 'offramp_reserve',
    amount: input.amount,
    postings: postingsFor.reserve(input.amount),
    refType: 'offramp',
    refId: input.txnRef,
    actor: 'system',
  });
}

export interface WalletFundingInfo {
  userId: string;
  asset: WalletAsset;
  amount: Decimal;
  txnRef: string;
}

/**
 * Book the end of a wallet-funded offramp in the caller's transaction:
 * COMPLETED settles the reserve (money left to the payout), CANCELLED or
 * REFUNDED returns it to available. Only the first ending posts (shared
 * key). REFUNDED after a settle credits the amount back once.
 * Returns what was posted, or null.
 */
export async function finalizeWalletOfframp(
  tx: Tx,
  f: WalletFundingInfo,
  status: 'COMPLETED' | 'CANCELLED' | 'REFUNDED'
): Promise<JournalType | null> {
  const reserve = await tx.walletJournal.findUnique({ where: { idempotencyKey: offrampReserveKey(f.txnRef) } });
  if (!reserve) {
    logger.error({ txnRef: f.txnRef, status }, 'wallet offramp ended without a reserve; nothing posted');
    return null;
  }
  const amount = new Decimal(reserve.amount);
  const final = await tx.walletJournal.findUnique({ where: { idempotencyKey: offrampFinalKey(f.txnRef) } });
  if (!final) {
    const settle = status === 'COMPLETED';
    await postJournal(tx, {
      idempotencyKey: offrampFinalKey(f.txnRef),
      userId: f.userId,
      asset: f.asset,
      type: settle ? 'offramp_settle' : 'offramp_release',
      amount,
      postings: settle ? postingsFor.settle(amount, 'external:offramp') : postingsFor.release(amount),
      refType: 'offramp',
      refId: f.txnRef,
      actor: 'system',
      note: `offramp ${status.toLowerCase()}`,
    });
    return settle ? 'offramp_settle' : 'offramp_release';
  }
  if (final.type === 'offramp_settle' && status === 'REFUNDED') {
    await postJournal(tx, {
      idempotencyKey: offrampRefundKey(f.txnRef),
      userId: f.userId,
      asset: f.asset,
      type: 'offramp_refund',
      amount,
      postings: postingsFor.refundAfterSettle(amount),
      refType: 'offramp',
      refId: f.txnRef,
      actor: 'system',
      note: 'offramp refunded after payout',
    });
    return 'offramp_refund';
  }
  if (final.type === 'offramp_release' && status === 'COMPLETED') {
    logger.error({ txnRef: f.txnRef }, 'wallet offramp COMPLETED after its reserve was released; needs an admin adjustment');
  }
  return null;
}

// --- Withdrawals ----------------------------------------------------------------

export interface WalletWithdrawalRow {
  id: string;
  requestId: string;
  txnRef: string;
  userId: string;
  asset: string;
  chain: string;
  amount: Decimal;
  address: string;
  memo: string | null;
  status: string;
  orchestratorWithdrawalId: string | null;
  txHash: string | null;
  failureReason: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Create a withdrawal and reserve its amount, atomically. Same requestId twice returns the first. */
export async function createWalletWithdrawal(input: {
  requestId: string;
  userId: string;
  asset: WalletAsset;
  chain: string;
  amount: Decimal;
  address: string;
  memo?: string | null;
}): Promise<{ row: WalletWithdrawalRow; created: boolean }> {
  return inWalletTx(async (tx) => {
    const prior = await tx.walletWithdrawal.findUnique({ where: { requestId: input.requestId } });
    if (prior) return { row: prior as WalletWithdrawalRow, created: false };
    const wallet = await tx.businessWallet.findUnique({ where: { userId: input.userId } });
    if (!wallet?.enabled) throw new Error('WALLET_NOT_ENABLED');
    if (wallet.debitsPaused) throw new WalletDebitsPausedError(wallet.pausedReason);
    if (!(await isAllowedWithdrawalDestination(input.userId, input.chain, input.address, tx))) throw new Error('ADDRESS_NOT_WHITELISTED');
    const txnRef = generateWalletWithdrawalRef();
    await postJournal(tx, {
      idempotencyKey: `withdrawal:${txnRef}:reserve`,
      userId: input.userId,
      asset: input.asset,
      type: 'withdrawal_reserve',
      amount: input.amount,
      postings: postingsFor.reserve(input.amount),
      refType: 'withdrawal',
      refId: txnRef,
      actor: 'system',
    });
    const row = await tx.walletWithdrawal.create({
      data: {
        requestId: input.requestId,
        txnRef,
        userId: input.userId,
        asset: input.asset,
        chain: input.chain,
        amount: input.amount,
        address: input.address,
        memo: input.memo ?? null,
        status: 'pending_approval',
      },
    });
    return { row: row as WalletWithdrawalRow, created: true };
  });
}

export async function findWalletWithdrawalById(id: string): Promise<WalletWithdrawalRow | null> {
  return (await prisma.walletWithdrawal.findUnique({ where: { id } })) as WalletWithdrawalRow | null;
}

export async function findWalletWithdrawalByRef(txnRef: string): Promise<WalletWithdrawalRow | null> {
  return (await prisma.walletWithdrawal.findUnique({ where: { txnRef } })) as WalletWithdrawalRow | null;
}

export async function listWalletWithdrawals(params: { userId?: string; status?: string[]; limit?: number }): Promise<WalletWithdrawalRow[]> {
  return (await prisma.walletWithdrawal.findMany({
    where: {
      ...(params.userId ? { userId: params.userId } : {}),
      ...(params.status ? { status: { in: params.status } } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(params.limit ?? 100, 500),
  })) as WalletWithdrawalRow[];
}

/** Move a withdrawal from one status to another only if it is still in `from` (no double approval). */
export async function transitionWalletWithdrawal(
  id: string,
  from: string[],
  data: Partial<Pick<WalletWithdrawalRow, 'status' | 'orchestratorWithdrawalId' | 'txHash' | 'failureReason' | 'approvedBy' | 'approvedAt' | 'rejectedBy' | 'rejectedAt'>>
): Promise<WalletWithdrawalRow | null> {
  const res = await prisma.walletWithdrawal.updateMany({ where: { id, status: { in: from } }, data });
  if (res.count !== 1) return null;
  return findWalletWithdrawalById(id);
}

/**
 * End a withdrawal: 'completed' settles the reserve, 'failed' / 'rejected'
 * release it. Status change and ledger post in one transaction; only the
 * first ending posts.
 */
export async function finishWalletWithdrawal(
  id: string,
  outcome: 'completed' | 'failed' | 'rejected',
  data: { txHash?: string | null; failureReason?: string | null; actor: string }
): Promise<WalletWithdrawalRow | null> {
  return inWalletTx(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "WalletWithdrawal" WHERE "id" = ${id} FOR UPDATE`;
    if (locked.length === 0) return null;
    const w = await tx.walletWithdrawal.findUniqueOrThrow({ where: { id } });
    if (['completed', 'failed', 'rejected'].includes(w.status)) return w as WalletWithdrawalRow;
    if (outcome === 'rejected' && w.status !== 'pending_approval') throw new Error('WITHDRAWAL_NOT_PENDING');
    const amount = new Decimal(w.amount);
    const settle = outcome === 'completed';
    await postJournal(tx, {
      idempotencyKey: `withdrawal:${w.txnRef}:final`,
      userId: w.userId,
      asset: assertAsset(w.asset),
      type: settle ? 'withdrawal_settle' : 'withdrawal_release',
      amount,
      postings: settle ? postingsFor.settle(amount, 'external:withdrawal') : postingsFor.release(amount),
      refType: 'withdrawal',
      refId: w.txnRef,
      actor: data.actor,
      note: data.failureReason ?? null,
    });
    const now = new Date();
    return (await tx.walletWithdrawal.update({
      where: { id },
      data: {
        status: outcome,
        ...(data.txHash !== undefined ? { txHash: data.txHash } : {}),
        ...(data.failureReason !== undefined ? { failureReason: data.failureReason } : {}),
        ...(outcome === 'rejected' ? { rejectedBy: data.actor, rejectedAt: now } : {}),
      },
    })) as WalletWithdrawalRow;
  });
}

// --- Adjustments ----------------------------------------------------------------

/** Admin correction: signed amount onto available, with a reason. `requestKey` makes a double submit post once. */
export async function postAdjustment(input: {
  userId: string;
  asset: WalletAsset;
  signedAmount: Decimal;
  actor: string;
  reason: string;
  requestKey: string;
}): Promise<PostJournalResult> {
  if (!input.reason.trim()) throw new Error('ADJUSTMENT_REASON_REQUIRED');
  if (input.signedAmount.isZero()) throw new Error('ADJUSTMENT_ZERO');
  return inWalletTx((tx) =>
    postJournal(tx, {
      idempotencyKey: `adjustment:${input.requestKey}`,
      userId: input.userId,
      asset: input.asset,
      type: 'adjustment',
      amount: input.signedAmount.abs(),
      postings: postingsFor.adjustment(input.signedAmount),
      refType: 'adjustment',
      refId: input.requestKey,
      actor: input.actor,
      note: input.reason,
    })
  );
}

/** Admin hold: pause or resume debits (offramps, withdrawals) for a business. Credits still post. */
export async function setDebitsPaused(userId: string, paused: boolean, reason: string | null, actor: string): Promise<void> {
  await prisma.businessWallet.update({
    where: { userId },
    data: { debitsPaused: paused, pausedReason: paused ? reason : null, updatedBy: actor },
  });
}
