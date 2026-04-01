/**
 * Offramp controllers. Palremit §5 deposits + §6.1 fiat withdrawal; idempotency: duplicate requestId → 409.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import * as offrampCore from '@/core/offramps';
import * as offrampRepo from '@/db/repositories/offramp.repo';
import * as userRepo from '@/db/repositories/user.repo';
import * as accountRepo from '@/db/repositories/account.repo';
import * as walletRepo from '@/db/repositories/wallet.repo';
import {
  createPalremitLiquidityAdapter,
  createPalremitCurrencyAdapter,
} from '@/services/palremitAdapters';
import {
  createOfframpPalremitCryptoDeposit,
  getPalremitOfframpRates,
} from '@/core/integrations';
import type {
  CreateOfframpDestinationInput,
  CreateOfframpSourceInput,
  GetOfframpRatesResponse,
  PlatformFee,
} from '@/types/offramp';
import {
  cancelOfframpBodySchema,
  createOfframpBodySchema,
  getOfframpRatesQuerySchema,
  listOfframpsQuerySchema,
} from '@/api/v1/offramps/schemas';

const REQUEST_ID_HEADER = 'requestid';

const palremitLiquidity = createPalremitLiquidityAdapter();
const palremitCurrency = createPalremitCurrencyAdapter();

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

const getRateFromPalremit = async (
  from: string,
  to: string,
  fromChain?: string
): Promise<GetOfframpRatesResponse | null> => {
  return getPalremitOfframpRates(palremitCurrency, from, to, fromChain);
};

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
      { getRateFromPalremit }
    );
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message === 'PALREMIT_RATES_UNAVAILABLE') {
      next(new AppError('Palremit rates unavailable', 'BAD_GATEWAY', 502));
      return;
    }
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
    const body: {
      source: CreateOfframpSourceInput;
      destination: CreateOfframpDestinationInput;
      platformFee: PlatformFee;
      metadata?: Record<string, unknown>;
    } = {
      source: parsed.data.source as CreateOfframpSourceInput,
      destination: parsed.data.destination as CreateOfframpDestinationInput,
      platformFee: parsed.data.platformFee,
      metadata: parsed.data.metadata,
    };
    const result = await offrampCore.createOfframp(
      repos.offramp,
      repos.user,
      repos.account,
      repos.wallet,
      repos.kyb,
      raw,
      body,
      {
        getRateFromPalremit,
        createPalremitDeposit: (userCtx, b, rid, depositBy) =>
          createOfframpPalremitCryptoDeposit(
            palremitLiquidity,
            userCtx,
            {
              setPalremitChannelUserIdIfAbsent: userRepo.setPalremitChannelUserIdIfAbsent,
              getPalremitChannelUserId: userRepo.getPalremitChannelUserId,
            },
            b,
            rid,
            depositBy
          ),
      }
    );
    sendSuccess(res, result, 201);
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
    if (e instanceof Error && e.message === 'PALREMIT_RATES_UNAVAILABLE') {
      next(new AppError('Palremit rates unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_DEPOSIT_ADDRESS_FAILED') {
      next(new AppError('Palremit deposit address creation failed', 'BAD_GATEWAY', 502));
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
    await offrampCore.advanceOfframpIfDepositReady(
      {
        findOfframpById: repos.offramp.findOfframpById,
        updateOfframpStatus: repos.offramp.updateOfframpStatus,
      },
      { findAccountByIdAndUser: repos.account.findAccountByIdAndUser },
      palremitLiquidity,
      id
    );
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
    const parsed = cancelOfframpBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { id } = req.params;
    const result = await offrampCore.cancelOfframp(repos.offramp, id, parsed.data);
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
