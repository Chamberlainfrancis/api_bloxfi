/**
 * Offramp controllers. Palremit Liquidity Orchestrator deposits + withdrawals; idempotency: duplicate requestId → 409.
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
  fetchPalremitWithdrawalFeeQuote,
} from '@/core/integrations';
import { buildRampFeePreview } from '@/core/payments';
import {
  resolvePalremitNetworkOrThrow,
  UnsupportedPalremitNetworkError,
} from '@/core/integrations/palremitCoinNetworks';
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
  retryOfframpFiatPayoutBodySchema,
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
    findOfframpAccountByIdAndUser: accountRepo.findOfframpAccountByIdAndUser,
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
    // Optional fee preview when amount + corridor inputs are supplied.
    const q = parsed.data;
    if (q.amount != null && q.country && q.destinationType) {
      const rateNum = parseFloat(result.conversionRate) || 0;
      const feeQuote = await fetchPalremitWithdrawalFeeQuote(palremitLiquidity, {
        asset: result.toCurrency,
        amount: q.amount * rateNum,
        destinationType: q.destinationType,
        country: q.country,
        beneficiaryType: q.beneficiaryType ?? undefined,
      });
      result.quote = buildRampFeePreview({
        sendAmount: q.amount,
        sendCurrency: result.fromCurrency,
        receiveCurrency: result.toCurrency,
        rate: rateNum,
        receiveDecimals: 2,
        feeQuote,
      });
    }
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
        resolvePalremitNetwork: (coinCode, chainFromClient, field) =>
          resolvePalremitNetworkOrThrow(palremitLiquidity, coinCode, chainFromClient, field),
        createPalremitDeposit: (userCtx, b, rid, depositBy, txnRef) =>
          createOfframpPalremitCryptoDeposit(palremitLiquidity, userCtx, b, rid, depositBy, txnRef),
        getProviderWithdrawalFeeQuote: (input) =>
          fetchPalremitWithdrawalFeeQuote(palremitLiquidity, input),
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
    if (e instanceof Error && e.message === 'USER_EMAIL_REQUIRED_FOR_OFFRAMP') {
      next(new AppError('User business email is required for offramp', 'UNPROCESSABLE_ENTITY', 422));
      return;
    }
    if (e instanceof Error && e.message === 'AMOUNT_TOO_LOW_AFTER_FEES') {
      next(
        new AppError(
          'Amount too low: the Palremit payout fee meets or exceeds the receive amount',
          'UNPROCESSABLE_ENTITY',
          422
        )
      );
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_DEPOSIT_ADDRESS_FAILED') {
      next(new AppError('Palremit deposit address creation failed', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof UnsupportedPalremitNetworkError) {
      next(
        new AppError(e.message, 'INVALID_REQUEST', 400, {
          field: e.field,
          coinCode: e.coinCode,
          requestedChain: e.requestedChain,
          validNetworkCodes: e.validNetworkCodes,
        })
      );
      return;
    }
    if (e instanceof Error && e.message === 'ACCOUNT_CURRENCY_MISMATCH') {
      next(
        new AppError(
          'Linked account currency must match destination.currency',
          'INVALID_REQUEST',
          400
        )
      );
      return;
    }
    if (e instanceof Error && e.message === 'ACCOUNT_INCOMPLETE_FOR_OFFRAMP') {
      next(
        new AppError(
          'Offramp account incomplete: create the account via payout corridors (corridor + destination) so providerPayout is stored',
          'INVALID_REQUEST',
          400
        )
      );
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_COIN_UNAVAILABLE') {
      next(new AppError('Palremit coin metadata unavailable', 'BAD_GATEWAY', 502));
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

/**
 * POST /offramps/:id/retry-fiat-payout
 * Bearer API key + requestId header + body.userId must match offramp owner.
 * Idempotent: existing Palremit withdrawal id → 200 without second LP call.
 */
export async function retryOfframpFiatPayout(
  req: Request<{ id: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = retryOfframpFiatPayoutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors
        .map((e) => `${e.path.join('.')}: ${e.message}`)
        .join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { id } = req.params;
    const outcome = await offrampCore.retryOfframpFiatPayout(
      {
        findOfframpById: repos.offramp.findOfframpById,
        updateOfframpStatus: repos.offramp.updateOfframpStatus,
      },
      { findOfframpAccountByIdAndUser: repos.account.findOfframpAccountByIdAndUser },
      palremitLiquidity,
      { offrampId: id, userId: parsed.data.userId }
    );

    if (outcome.status === 'rejected') {
      next(new AppError(outcome.message, outcome.code, outcome.statusCode));
      return;
    }

    if (outcome.status === 'failed_to_initiate') {
      next(
        new AppError(outcome.message, 'FIAT_PAYOUT_NOT_INITIATED', 422, {
          txnRef: outcome.txnRef,
        })
      );
      return;
    }

    const details = await offrampCore.getOfframp(repos.offramp, id);
    sendSuccess(
      res,
      {
        retry:
          outcome.status === 'initiated'
            ? { status: 'initiated', withdrawalId: outcome.withdrawalId, txnRef: outcome.txnRef }
            : {
                status: 'already_initiated',
                withdrawalId: outcome.withdrawalId,
                txnRef: outcome.txnRef,
              },
        transferDetails: details?.transferDetails ?? null,
      },
      200
    );
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
