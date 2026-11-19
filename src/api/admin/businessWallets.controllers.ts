/**
 * Admin dashboard: business wallets. Every write needs the dashboard passcode
 * and an actor name; every balance change goes through the ledger.
 */

import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { env } from '@/config/env';
import { Prisma } from '@/generated/prisma/client';
import * as repo from '@/db/repositories/businessWallet.repo';
import * as userRepo from '@/db/repositories/user.repo';
import { enableWalletChains } from '@/core/businessWallets/provisionWallet';
import {
  approveWalletWithdrawal,
  rejectWalletWithdrawal,
  withdrawalView,
  WalletWithdrawalError,
} from '@/core/businessWallets/walletWithdrawals';
import { WALLET_ALLOWED_CHAINS, isAllowedWalletChain, normalizeWalletAddress } from '@/core/businessWallets/chains';
import { provisionWalletDeps, walletWithdrawalDeps } from '@/services/businessWallets';

function requireSecret(req: Request): void {
  const body = (req.body ?? {}) as { secret?: unknown };
  const header = req.headers['x-dashboard-secret'];
  const provided = (typeof header === 'string' ? header : undefined) ?? (typeof body.secret === 'string' ? body.secret : '');
  if (!env.DASHBOARD_MARK_SECRET || provided !== env.DASHBOARD_MARK_SECRET) {
    throw new AppError('Incorrect passcode', 'UNAUTHORIZED', 401);
  }
}

function zodMessage(err: z.ZodError): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {});
  if (!r.success) throw new AppError(zodMessage(r.error), 'INVALID_REQUEST', 400);
  return r.data;
}

const actor = z.string().trim().min(1, 'your name is required').max(200);
const asset = z.enum(['USDT', 'USDC']);

/** Repo errors are plain codes; turn the known ones into clear HTTP answers. */
function mapError(e: unknown): unknown {
  if (e instanceof repo.InsufficientWalletBalanceError) return new AppError(e.message, 'INSUFFICIENT_WALLET_BALANCE', 422);
  if (e instanceof repo.WalletDebitsPausedError) return new AppError(e.message, 'WALLET_DEBITS_PAUSED', 423);
  if (e instanceof WalletWithdrawalError) return new AppError(e.message, e.code, e.httpStatus);
  const m = e instanceof Error ? e.message : '';
  const known: Record<string, [string, number]> = {
    USER_NOT_FOUND: ['Business not found', 404],
    DEPOSIT_NOT_FOUND: ['Deposit not found', 404],
    DEPOSIT_NOT_QUARANTINED: ['Deposit is not held any more (already credited or refunded)', 409],
    ADJUSTMENT_REASON_REQUIRED: ['A reason is required', 400],
    ADJUSTMENT_ZERO: ['Amount cannot be 0', 400],
  };
  if (known[m]) return new AppError(known[m][0], m, known[m][1]);
  if (m.startsWith('CHAIN_NOT_ALLOWED:')) return new AppError(`${m.slice(18)} is not an allowed wallet chain`, 'CHAIN_NOT_ALLOWED', 400);
  return e;
}

function wrap(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (e) {
      next(mapError(e));
    }
  };
}

function businessName(user: { businessInfo: unknown } | null): string {
  const bi = user?.businessInfo;
  if (bi && typeof bi === 'object' && !Array.isArray(bi)) {
    const r = bi as Record<string, unknown>;
    return String(r.tradingName ?? r.legalName ?? r.businessName ?? '');
  }
  return '';
}

function depositView(d: repo.WalletDepositRow) {
  return { ...d, amount: new Prisma.Decimal(d.amount).toString() };
}

/** GET /business-wallets — every business with a wallet, with balances, plus queues. */
export const listWallets = wrap(async (_req, res) => {
  const wallets = await repo.listBusinessWallets();
  const items = await Promise.all(
    wallets.map(async (w) => {
      const [user, balances] = await Promise.all([userRepo.findUserById(w.userId), repo.getBalances(w.userId)]);
      return { ...w, businessName: businessName(user), balances };
    })
  );
  const [quarantined, pendingWithdrawals] = await Promise.all([
    repo.listWalletDeposits({ status: ['quarantined', 'refund_pending'] }),
    repo.listWalletWithdrawals({ status: ['pending_approval', 'approved'] }),
  ]);
  sendSuccess(res, {
    items,
    allowedChains: WALLET_ALLOWED_CHAINS,
    quarantined: quarantined.map(depositView),
    pendingWithdrawals: pendingWithdrawals.map(withdrawalView),
  });
});

/** GET /business-wallets/:userId — everything about one business wallet. */
export const getWallet = wrap(async (req, res) => {
  const { userId } = req.params;
  const user = await userRepo.findUserById(userId);
  if (!user) throw new AppError('Business not found', 'NOT_FOUND', 404);
  const [wallet, addresses, whitelist, registeredWallets, balances, journals, deposits, withdrawals] = await Promise.all([
    repo.findBusinessWallet(userId),
    repo.listDepositAddresses(userId),
    repo.listWhitelist(userId, true),
    repo.listRegisteredWithdrawalWallets(userId),
    repo.getBalances(userId),
    repo.listJournals({ userId, limit: 100 }),
    repo.listWalletDeposits({ userId, limit: 100 }),
    repo.listWalletWithdrawals({ userId, limit: 100 }),
  ]);
  sendSuccess(res, {
    userId,
    businessName: businessName(user),
    wallet,
    addresses,
    whitelist,
    registeredWallets,
    balances,
    journals,
    deposits: deposits.map(depositView),
    withdrawals: withdrawals.map(withdrawalView),
    allowedChains: WALLET_ALLOWED_CHAINS,
  });
});

const enableSchema = z.object({
  actor,
  chains: z.array(z.object({ asset, chain: z.string().trim().toUpperCase() })).min(1),
});

/** POST /business-wallets/:userId/enable — switch on and open deposit addresses for the chosen chains. */
export const enableWallet = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(enableSchema, req.body);
  const out = await enableWalletChains(provisionWalletDeps, req.params.userId, b.chains, b.actor);
  sendSuccess(res, out);
});

const settingsSchema = z.object({
  actor,
  enabled: z.boolean().optional(),
  walletOnly: z.boolean().optional(),
  whitelistRequired: z.boolean().optional(),
});

/** PATCH /business-wallets/:userId/settings */
export const updateSettings = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(settingsSchema, req.body);
  const existing = await repo.findBusinessWallet(req.params.userId);
  if (!existing) throw new AppError('Enable the wallet first', 'WALLET_NOT_ENABLED', 409);
  const { actor: who, ...patch } = b;
  sendSuccess(res, { wallet: await repo.upsertBusinessWallet(req.params.userId, patch, who) });
});

const pauseSchema = z.object({ actor, paused: z.boolean(), reason: z.string().trim().max(500).optional() });

/** POST /business-wallets/:userId/pause — stop or resume debits (offramps, withdrawals). Credits keep posting. */
export const pauseDebits = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(pauseSchema, req.body);
  if (b.paused && !b.reason) throw new AppError('Say why debits are paused', 'INVALID_REQUEST', 400);
  const existing = await repo.findBusinessWallet(req.params.userId);
  if (!existing) throw new AppError('Wallet not enabled', 'WALLET_NOT_ENABLED', 409);
  await repo.setDebitsPaused(req.params.userId, b.paused, b.reason ?? null, b.actor);
  sendSuccess(res, { wallet: await repo.findBusinessWallet(req.params.userId) });
});

const whitelistSchema = z.object({
  actor,
  chain: z.string().trim().toUpperCase(),
  address: z.string().trim().min(10).max(128),
  label: z.string().trim().max(120).optional(),
  reason: z.string().trim().max(500).optional(),
});

function chainAllowedAnyAsset(chain: string): boolean {
  return isAllowedWalletChain('USDT', chain) || isAllowedWalletChain('USDC', chain);
}

/** POST /business-wallets/:userId/whitelist */
export const addWhitelist = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(whitelistSchema, req.body);
  if (!chainAllowedAnyAsset(b.chain)) throw new AppError(`${b.chain} is not a wallet chain`, 'CHAIN_NOT_ALLOWED', 400);
  const address = normalizeWalletAddress(b.chain, b.address);
  if (!address) throw new AppError(`Not a valid ${b.chain} address`, 'INVALID_ADDRESS', 400);
  const user = await userRepo.findUserById(req.params.userId);
  if (!user) throw new AppError('Business not found', 'NOT_FOUND', 404);
  const row = await repo.addWhitelistAddress({
    userId: req.params.userId,
    chain: b.chain,
    address,
    label: b.label ?? null,
    addedBy: b.actor,
    reason: b.reason ?? null,
  });
  sendSuccess(res, { address: row }, 201);
});

/** POST /business-wallets/:userId/whitelist/:id/remove */
export const removeWhitelist = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(z.object({ actor }), req.body);
  const row = await repo.removeWhitelistAddress(req.params.id, req.params.userId, b.actor);
  if (!row) throw new AppError('Address not found or already removed', 'NOT_FOUND', 404);
  sendSuccess(res, { address: row });
});

const depositActionSchema = z.object({ actor, note: z.string().trim().min(3, 'add a note').max(500) });

/** POST /business-wallet-deposits/:id/credit — release a held deposit into the balance (once). */
export const creditDeposit = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(depositActionSchema, req.body);
  const row = await repo.creditQuarantinedDeposit(req.params.id, b.actor, b.note);
  sendSuccess(res, { deposit: depositView(row) });
});

/** POST /business-wallet-deposits/:id/refund — mark a held deposit refund pending / refunded (never credits). */
export const refundDeposit = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(depositActionSchema.extend({ status: z.enum(['refund_pending', 'refunded']) }), req.body);
  const row = await repo.setQuarantinedDepositRefund(req.params.id, b.status, b.actor, b.note);
  sendSuccess(res, { deposit: depositView(row) });
});

/** POST /business-wallet-withdrawals/:id/approve — sends on chain. Retrying never sends twice. */
export const approveWithdrawal = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(z.object({ actor }), req.body);
  const row = await approveWalletWithdrawal(walletWithdrawalDeps, req.params.id, b.actor);
  sendSuccess(res, { withdrawal: withdrawalView(row) });
});

/** POST /business-wallet-withdrawals/:id/reject — releases the reserved amount. */
export const rejectWithdrawal = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(z.object({ actor, reason: z.string().trim().min(3).max(500) }), req.body);
  const row = await rejectWalletWithdrawal(walletWithdrawalDeps, req.params.id, b.actor, b.reason);
  sendSuccess(res, { withdrawal: withdrawalView(row) });
});

const adjustmentSchema = z.object({
  actor,
  asset,
  amount: z.string().trim().regex(/^-?\d+(\.\d{1,6})?$/, 'signed decimal, at most 6 decimal places'),
  reason: z.string().trim().min(5, 'explain the adjustment').max(500),
  requestKey: z.string().trim().min(8).max(100),
});

/** POST /business-wallets/:userId/adjustments — logged correction; a double submit posts once (requestKey). */
export const postAdjustment = wrap(async (req, res) => {
  requireSecret(req);
  const b = parse(adjustmentSchema, req.body);
  const wallet = await repo.findBusinessWallet(req.params.userId);
  if (!wallet) throw new AppError('Wallet not enabled', 'WALLET_NOT_ENABLED', 409);
  const r = await repo.postAdjustment({
    userId: req.params.userId,
    asset: b.asset,
    signedAmount: new Prisma.Decimal(b.amount),
    actor: b.actor,
    reason: b.reason,
    requestKey: `${req.params.userId}:${b.requestKey}`,
  });
  sendSuccess(res, { result: r, balances: await repo.getBalances(req.params.userId) });
});
