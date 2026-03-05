/**
 * External wallet controllers. Validate → call core → return standardized response.
 * No Prisma/Redis/business logic here.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../../utils';
import { AppError } from '../../../types';
import * as walletCore from '../../../core/wallets';
import * as walletRepo from '../../../db/repositories/wallet.repo';
import * as userRepo from '../../../db/repositories/user.repo';
import {
  addExternalWalletBodySchema,
  listExternalWalletsQuerySchema,
  updateExternalWalletBodySchema,
} from './schemas';

const REQUEST_ID_HEADER = 'requestid';

const repo = {
  createExternalWallet: walletRepo.createExternalWallet,
  findExternalWalletByIdAndUser: walletRepo.findExternalWalletByIdAndUser,
  listExternalWallets: walletRepo.listExternalWallets,
  updateExternalWallet: walletRepo.updateExternalWallet,
  deleteExternalWallet: walletRepo.deleteExternalWallet,
  hasPendingTransactions: walletRepo.hasPendingTransactions,
};

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function addExternalWallet(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = addExternalWalletBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const requestId = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(requestId) ? requestId[0] : requestId;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
      return;
    }
    const { userId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await walletCore.addExternalWallet(repo, userId, parsed.data);
    sendSuccess(res, result, 201);
  } catch (e) {
    const prismaError = e as { code?: string };
    if (prismaError.code === 'P2002') {
      next(new AppError('Wallet with same address and chain already exists for this user', 'CONFLICT', 409));
      return;
    }
    next(e);
  }
}

export async function listExternalWallets(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const queryParsed = listExternalWalletsQuerySchema.safeParse(req.query);
    if (!queryParsed.success) {
      const message = queryParsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, queryParsed.error.flatten()));
      return;
    }
    const { userId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await walletCore.listExternalWallets(repo, userId, queryParsed.data);
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('INVALID_CURSOR:')) {
      next(new AppError(e.message.replace('INVALID_CURSOR:', '').trim(), 'INVALID_REQUEST', 400));
      return;
    }
    next(e);
  }
}

export async function getExternalWallet(
  req: Request<{ userId: string; walletId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, walletId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await walletCore.getExternalWallet(repo, userId, walletId);
    if (!result) {
      next(new AppError('Wallet not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function updateExternalWallet(
  req: Request<{ userId: string; walletId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = updateExternalWalletBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { userId, walletId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await walletCore.updateExternalWallet(repo, userId, walletId, parsed.data);
    if (!result) {
      next(new AppError('Wallet not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function deleteExternalWallet(
  req: Request<{ userId: string; walletId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId, walletId } = req.params;
    const user = await userRepo.findUserById(userId);
    if (!user) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    const result = await walletCore.deleteExternalWallet(repo, userId, walletId);
    if (!result) {
      next(new AppError('Wallet not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message === 'WALLET_HAS_PENDING_TRANSACTIONS') {
      next(
        new AppError(
          'Cannot delete wallet with pending transactions',
          'INVALID_REQUEST',
          400
        )
      );
      return;
    }
    next(e);
  }
}
