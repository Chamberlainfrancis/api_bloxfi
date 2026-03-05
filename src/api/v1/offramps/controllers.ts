/**
 * Offramp controllers. Validate → call core → return standardized response.
 * No Prisma/Redis/business logic here. Idempotency: duplicate requestId → 409.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../../utils';
import { AppError } from '../../../types';
import * as offrampCore from '../../../core/offramps';
import * as offrampRepo from '../../../db/repositories/offramp.repo';
import * as userRepo from '../../../db/repositories/user.repo';
import * as accountRepo from '../../../db/repositories/account.repo';
import * as walletRepo from '../../../db/repositories/wallet.repo';
import { env } from '../../../config/env';
import { getLpClient } from '../../../services/lpClient';
import { getRate as getRateFromCurrencyApiService } from '../../../services/currencyApi';
import { palremitLiquidityRequest } from '../../../services/palremitClient';
import { createOfframpViaPalremit } from '../../../core/integrations';
import type { PalremitLiquidityRequestFn } from '../../../core/integrations/palremitLiquidity';
import type { GetOfframpRatesResponse } from '../../../types/offramp';
import {
  createOfframpBodySchema,
  getOfframpRatesQuerySchema,
  listOfframpsQuerySchema,
} from './schemas';

const REQUEST_ID_HEADER = 'requestid';

const repos = {
  offramp: {
    createOfframp: offrampRepo.createOfframp,
    findOfframpById: offrampRepo.findOfframpById,
    findOfframpByRequestId: offrampRepo.findOfframpByRequestId,
    listOfframps: offrampRepo.listOfframps,
    updateOfframpStatus: offrampRepo.updateOfframpStatus,
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

/** Currency API as sole rate source for offramp (RAMP_ARCHITECTURE). */
const getRateFromCurrencyApi = async (
  from: string,
  to: string,
  fromChain?: string
): Promise<GetOfframpRatesResponse | null> => {
  const result = await getRateFromCurrencyApiService(from, to);
  if (!result) return null;
  return {
    fromCurrency: from,
    toCurrency: to,
    fromChain: fromChain ?? undefined,
    rate: result.rate,
    inverseRate: result.inverseRate,
  };
};

/** Palremit liquidity API adapter for offramp order creation. */
const palremitLiquidityAdapter = (
  path: string,
  opts?: { method?: 'GET' | 'POST'; body?: unknown }
) =>
  palremitLiquidityRequest(path, opts as { method?: 'GET' | 'POST'; body?: unknown }).then((r) => ({
    status: r.status,
    data: r.data,
  }));

const createViaPalremitFn = env.PALREMIT_LIQUIDITY_URL
  ? (
      user: { businessInfo: unknown },
      account: { accountHolder: unknown; regionDetails: unknown; paymentRail: string },
      body: Parameters<typeof createOfframpViaPalremit>[3],
      depositBy: string
    ) =>
      createOfframpViaPalremit(
        palremitLiquidityAdapter as PalremitLiquidityRequestFn,
        user,
        account,
        body,
        depositBy
      )
  : undefined;

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function getOfframpRates(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = getOfframpRatesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const result = await offrampCore.getOfframpRate(
      parsed.data.fromCurrency,
      parsed.data.toCurrency,
      parsed.data.fromChain,
      { getRateFromCurrencyApi }
    );
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function createOfframp(
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
    const parsed = createOfframpBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    if (parsed.data.requestId !== raw) {
      next(
        new AppError('requestId in body must match requestId header', 'INVALID_REQUEST', 400)
      );
      return;
    }
    const existing = await offrampRepo.findOfframpByRequestId(raw);
    if (existing) {
      next(new AppError('Duplicate requestId', 'CONFLICT', 409));
      return;
    }
    const { requestId: _reqId, ...body } = parsed.data;
    const result = await offrampCore.createOfframp(
      repos.offramp,
      repos.user,
      repos.account,
      repos.wallet,
      repos.kyb,
      lpClient,
      raw,
      body,
      {
        getRateFromCurrencyApi,
        createViaPalremit: createViaPalremitFn ?? undefined,
      }
    );
    sendSuccess(res, result, 200);
  } catch (e) {
    if (e instanceof Error && e.message === 'USER_NOT_FOUND') {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    if (e instanceof Error && e.message === 'USER_NOT_KYB_VERIFIED') {
      next(
        new AppError('User not KYB verified for this currency', 'UNPROCESSABLE_ENTITY', 422)
      );
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

export async function getOfframp(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const result = await offrampCore.getOfframp(repos.offramp, id);
    if (!result) {
      next(new AppError('Offramp not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function listOfframps(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = listOfframpsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const result = await offrampCore.listOfframps(repos.offramp, parsed.data);
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('INVALID_CURSOR:')) {
      next(
        new AppError(e.message.replace('INVALID_CURSOR:', '').trim(), 'INVALID_REQUEST', 400)
      );
      return;
    }
    next(e);
  }
}

export async function cancelOfframp(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params;
    const result = await offrampCore.cancelOfframp(repos.offramp, id);
    if (!result) {
      next(new AppError('Offramp not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result, 200);
  } catch (e) {
    if (e instanceof Error && e.message === 'OFFRAMP_NOT_CANCELLABLE') {
      next(
        new AppError(
          'Offramp can only be cancelled before crypto is received',
          'UNPROCESSABLE_ENTITY',
          422
        )
      );
      return;
    }
    next(e);
  }
}
