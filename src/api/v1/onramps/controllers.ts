/**
 * Onramp controllers. Validate → call core → return standardized response.
 * No Prisma/Redis/business logic here. Idempotency: duplicate requestId → 409.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../../utils';
import { AppError } from '../../../types';
import * as onrampCore from '../../../core/onramps';
import * as onrampRepo from '../../../db/repositories/onramp.repo';
import * as userRepo from '../../../db/repositories/user.repo';
import * as accountRepo from '../../../db/repositories/account.repo';
import * as walletRepo from '../../../db/repositories/wallet.repo';
import { getLpClient } from '../../../services/lpClient';
import { getRate as getRateFromCurrencyApiService } from '../../../services/currencyApi';
import type { GetOnrampRatesResponse } from '../../../types/onramp';
import type { CreateOnrampRequest } from '../../../types/onramp';
import {
  createOnrampBodySchema,
  getOnrampRatesQuerySchema,
  listOnrampsQuerySchema,
} from './schemas';

const REQUEST_ID_HEADER = 'requestid';

const repos = {
  onramp: {
    createOnramp: onrampRepo.createOnramp,
    findOnrampById: onrampRepo.findOnrampById,
    findOnrampByRequestId: onrampRepo.findOnrampByRequestId,
    listOnramps: onrampRepo.listOnramps,
  },
  user: {
    findUserById: userRepo.findUserById,
  },
  account: {
    findAccountByIdAndUser: accountRepo.findAccountByIdAndUser,
  },
  wallet: {
    findExternalWalletByIdAndUser: walletRepo.findExternalWalletByIdAndUser,
  },
  kyb: {
    getKybRailStatuses: userRepo.getKybRailStatuses,
  },
};

const lpClient = getLpClient();

/** Currency API as sole rate source for onramp (RAMP_ARCHITECTURE). */
const getRateFromCurrencyApi = (async (from: string, to: string): Promise<GetOnrampRatesResponse | null> => {
  const result = await getRateFromCurrencyApiService(from, to);
  if (!result) return null;
  return {
    fromCurrency: from,
    toCurrency: to,
    conversionRate: result.rate,
  };
});


function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function getOnrampRates(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = getOnrampRatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const result = await onrampCore.getOnrampRate(parsed.data.fromCurrency, parsed.data.toCurrency, {
      getRateFromCurrencyApi,
    });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function createOnramp(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const requestId = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(requestId) ? requestId[0] : requestId;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
      return;
    }
    const parsed = createOnrampBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    if (parsed.data.requestId !== raw) {
      next(new AppError('requestId in body must match requestId header', 'INVALID_REQUEST', 400));
      return;
    }
    const existing = await onrampRepo.findOnrampByRequestId(raw);
    if (existing) {
      next(new AppError('Duplicate requestId', 'CONFLICT', 409));
      return;
    }
    const { requestId: _reqId, ...body } = parsed.data;
    const result = await onrampCore.createOnramp(
      repos.onramp,
      repos.user,
      repos.account,
      repos.wallet,
      repos.kyb,
      lpClient,
      raw,
      body,
      { getRateFromCurrencyApi }
    );
    sendSuccess(res, result, 200);
  } catch (e) {
    if (e instanceof Error && e.message === 'USER_NOT_FOUND') {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    if (e instanceof Error && e.message === 'USER_NOT_KYB_VERIFIED') {
      next(new AppError('User not KYB verified for this currency', 'UNPROCESSABLE_ENTITY', 422));
      return;
    }
    if (e instanceof Error && e.message === 'ACCOUNT_NOT_FOUND') {
      next(new AppError('Account not found', 'NOT_FOUND', 404));
      return;
    }
    if (e instanceof Error && e.message === 'WALLET_NOT_FOUND') {
      next(new AppError('Wallet not found', 'NOT_FOUND', 404));
      return;
    }
    if (e instanceof Error && e.message === 'SOURCE_DESTINATION_USER_MISMATCH') {
      next(new AppError('Source and destination userId must match', 'INVALID_REQUEST', 400));
      return;
    }
    next(e);
  }
}

export async function getOnramp(
  req: Request<{ onrampId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { onrampId } = req.params;
    const result = await onrampCore.getOnramp(repos.onramp, onrampId);
    if (!result) {
      next(new AppError('Onramp not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function listOnramps(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = listOnrampsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const result = await onrampCore.listOnramps(repos.onramp, parsed.data);
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('INVALID_CURSOR:')) {
      next(new AppError(e.message.replace('INVALID_CURSOR:', '').trim(), 'INVALID_REQUEST', 400));
      return;
    }
    next(e);
  }
}
