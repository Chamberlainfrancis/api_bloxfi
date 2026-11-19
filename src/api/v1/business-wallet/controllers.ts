/**
 * Business wallet partner API (read balances and history, request withdrawals
 * to whitelisted addresses). Admin-only actions live in the admin dashboard.
 * Quarantined deposits are never shown here.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import * as repo from '@/db/repositories/businessWallet.repo';
import * as userRepo from '@/db/repositories/user.repo';
import {
  requestWalletWithdrawal,
  withdrawalView,
  WalletWithdrawalError,
} from '@/core/businessWallets/walletWithdrawals';
import { walletWithdrawalDeps } from '@/services/businessWallets';
import {
  walletTransactionsQuerySchema,
  walletWithdrawalBodySchema,
  walletWithdrawalsQuerySchema,
} from '@/api/v1/business-wallet/schemas';

const REQUEST_ID_HEADER = 'requestid';

function zodMessage(err: { errors: Array<{ path: (string | number)[]; message: string }> }): string {
  return err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
}

/** 404 unless the business exists and has its wallet switched on. */
async function enabledWallet(userId: string): Promise<repo.BusinessWalletRow> {
  const user = await userRepo.findUserById(userId);
  if (!user) throw new AppError('User not found', 'NOT_FOUND', 404);
  const wallet = await repo.findBusinessWallet(userId);
  if (!wallet?.enabled) throw new AppError('Wallet is not enabled for this business', 'WALLET_NOT_ENABLED', 404);
  return wallet;
}

/** Ledger journal types the business sees, with the names we show them. */
const TX_TYPE_LABEL: Record<string, string> = {
  deposit_credit: 'deposit',
  offramp_reserve: 'offramp_pending',
  offramp_settle: 'offramp_settled',
  offramp_release: 'offramp_released',
  offramp_refund: 'offramp_refunded',
  withdrawal_reserve: 'withdrawal_pending',
  withdrawal_settle: 'withdrawal_settled',
  withdrawal_release: 'withdrawal_released',
  adjustment: 'adjustment',
};

/** One balance shape for every endpoint: pending = held for offramps and withdrawals in progress. */
function balanceView(b: { asset: string; available: string; reserved: string }): { asset: string; available: string; pending: string } {
  return { asset: b.asset, available: b.available, pending: b.reserved };
}

export async function getWallet(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = req.params;
    const wallet = await enabledWallet(userId);
    const [addresses, balances] = await Promise.all([repo.listDepositAddresses(userId), repo.getBalances(userId)]);
    sendSuccess(res, {
      userId,
      enabled: wallet.enabled,
      walletOnly: wallet.walletOnly,
      whitelistRequired: wallet.whitelistRequired,
      debitsPaused: wallet.debitsPaused,
      balances: balances.map(balanceView),
      depositAddresses: addresses
        .filter((a) => a.status === 'active' && a.address)
        .map((a) => ({ asset: a.asset, chain: a.chain, address: a.address, memo: a.memo })),
    });
  } catch (e) {
    next(e);
  }
}

/** Balances only: available and pending per asset. */
export async function getBalances(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = req.params;
    await enabledWallet(userId);
    const balances = await repo.getBalances(userId);
    sendSuccess(res, {
      userId,
      balances: balances.map(balanceView),
    });
  } catch (e) {
    next(e);
  }
}

export async function listWalletTransactions(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const q = walletTransactionsQuerySchema.safeParse(req.query);
    if (!q.success) {
      next(new AppError(zodMessage(q.error), 'INVALID_REQUEST', 400));
      return;
    }
    const { userId } = req.params;
    await enabledWallet(userId);
    const rows = await repo.listJournals({ userId, asset: q.data.asset, limit: q.data.limit, before: q.data.before });
    sendSuccess(res, {
      transactions: rows.map((j) => ({
        id: j.id,
        type: TX_TYPE_LABEL[j.type] ?? j.type,
        asset: j.asset,
        amount: j.amount,
        availableChange: j.availableDelta,
        pendingChange: j.reservedDelta,
        reference: j.refType === 'offramp' || j.refType === 'withdrawal' ? j.refId : null,
        createdAt: j.createdAt.toISOString(),
      })),
    });
  } catch (e) {
    next(e);
  }
}

export async function listWhitelist(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = req.params;
    await enabledWallet(userId);
    const [rows, registered] = await Promise.all([repo.listWhitelist(userId), repo.listRegisteredWithdrawalWallets(userId)]);
    sendSuccess(res, {
      addresses: [
        ...rows.map((w) => ({ id: w.id, source: 'whitelist', chain: w.chain, address: w.address, label: w.label, createdAt: w.createdAt.toISOString() })),
        ...registered.map((w) => ({ id: w.id, source: 'external_wallet', chain: w.chain, address: w.address, label: w.label, createdAt: w.createdAt.toISOString() })),
      ],
    });
  } catch (e) {
    next(e);
  }
}

export async function createWithdrawal(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = walletWithdrawalBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new AppError(zodMessage(parsed.error), 'INVALID_REQUEST', 400));
      return;
    }
    const raw = req.headers[REQUEST_ID_HEADER];
    const requestId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!requestId) {
      next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
      return;
    }
    const { userId } = req.params;
    await enabledWallet(userId);
    const { row, created } = await requestWalletWithdrawal(walletWithdrawalDeps, { requestId, userId, ...parsed.data });
    if (row.userId !== userId) {
      next(new AppError('requestId already used', 'CONFLICT', 409));
      return;
    }
    sendSuccess(res, withdrawalView(row), created ? 201 : 200);
  } catch (e) {
    if (e instanceof WalletWithdrawalError) {
      next(new AppError(e.message, e.code, e.httpStatus));
      return;
    }
    next(e);
  }
}

export async function listWithdrawals(req: Request<{ userId: string }>, res: Response, next: NextFunction): Promise<void> {
  try {
    const q = walletWithdrawalsQuerySchema.safeParse(req.query);
    if (!q.success) {
      next(new AppError(zodMessage(q.error), 'INVALID_REQUEST', 400));
      return;
    }
    const { userId } = req.params;
    await enabledWallet(userId);
    const rows = await repo.listWalletWithdrawals({ userId, limit: q.data.limit });
    sendSuccess(res, { withdrawals: rows.map(withdrawalView) });
  } catch (e) {
    next(e);
  }
}

export async function getWithdrawal(
  req: Request<{ userId: string; withdrawalId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, withdrawalId } = req.params;
    await enabledWallet(userId);
    const row = await repo.findWalletWithdrawalById(withdrawalId).catch(() => null);
    if (!row || row.userId !== userId) {
      next(new AppError('Withdrawal not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, withdrawalView(row));
  } catch (e) {
    next(e);
  }
}
