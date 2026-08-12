/**
 * Onramp controllers. Palremit provisioned fiat deposit + rates; crypto withdrawal after `deposit.credited`; idempotency: duplicate requestId → 409.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import * as onrampCore from '@/core/onramps';
import * as onrampRepo from '@/db/repositories/onramp.repo';
import * as userRepo from '@/db/repositories/user.repo';
import * as walletRepo from '@/db/repositories/wallet.repo';
import {
  createPalremitLiquidityAdapter,
  createPalremitCurrencyAdapter,
} from '@/services/palremitAdapters';
import {
  createOnrampPalremitFiatDeposit,
  executePalremitOnrampCryptoWithdrawal,
  getPalremitOnrampRates,
  getPalremitOnrampQuote,
  fetchPalremitWithdrawalFeeQuote,
  getPalremitConversionAmount,
} from '@/core/integrations';
import { GraphOnrampKycError } from '@/core/integrations/graphOnrampKyc';
import { buildRampFeePreview } from '@/core/payments';
import {
  resolvePalremitNetworkOrThrow,
  UnsupportedPalremitNetworkError,
} from '@/core/integrations/palremitCoinNetworks';
import type { CreateOnrampDestinationInput, CreateOnrampRequest, CreateOnrampSourceInput } from '@/types/onramp';
import { createOnrampQuote } from '@/core/quotes';
import { hydrateOnrampCreateFromQuote } from '@/core/quotes/hydrateCreateFromQuote';
import * as rampQuoteRepo from '@/db/repositories/rampQuote.repo';
import { findOnrampAccountsByUser } from '@/db/repositories/account.repo';
import type { OnrampQuoteSnapshot } from '@/types/quote';
import {
  createOnrampBodySchema,
  createOnrampQuoteBodySchema,
  getOnrampRatesQuerySchema,
  listOnrampsQuerySchema,
} from '@/api/v1/onramps/schemas';

const REQUEST_ID_HEADER = 'requestid';

const palremitLiquidity = createPalremitLiquidityAdapter();
const palremitCurrency = createPalremitCurrencyAdapter();

const repos = {
  onramp: {
    createOnramp: onrampRepo.createOnramp,
    findOnrampById: onrampRepo.findOnrampById,
    findOnrampByRequestId: onrampRepo.findOnrampByRequestId,
    listOnramps: onrampRepo.listOnramps,
    listOnrampsAwaitingDeposit: onrampRepo.listOnrampsAwaitingDeposit,
    updateOnrampStatus: onrampRepo.updateOnrampStatus,
  },
  user: {
    findUserById: userRepo.findUserById,
  },
  wallet: {
    findExternalWalletByIdAndUser: walletRepo.findExternalWalletByIdAndUser,
  },
  kyb: {
    getKybRailStatuses: userRepo.getKybRailStatuses,
  },
};

const getRateFromPalremit = (from: string, to: string) =>
  getPalremitOnrampRates(palremitCurrency, from, to);

const getQuoteFromPalremit = async (from: string, to: string, amount: number) => {
  const result = await getPalremitOnrampQuote(palremitCurrency, from, to, amount);
  if (!result) return null;
  return {
    conversionRate: result.conversionRate,
    conversion: result.conversion,
    marketRate: result.marketRate ?? null,
    rateCurrency: result.rateCurrency ?? null,
    perCurrency: result.perCurrency ?? null,
  };
};

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
      getRateFromPalremit,
    });
    // Optional fee preview when amount + destination chain are supplied.
    // Onramp: fiat in → crypto out. Use the amount-specific conversion
    // (like createOnramp) rather than rate*amount, since conversionRate is
    // fiat-per-crypto and would invert the math.
    const q = parsed.data;
    if (q.amount != null && q.chain) {
      const oq = await getPalremitOnrampQuote(
        palremitCurrency,
        result.fromCurrency,
        result.toCurrency,
        q.amount
      );
      const grossReceive = oq?.conversion ?? 0;
      const feeQuote =
        grossReceive > 0
          ? await fetchPalremitWithdrawalFeeQuote(palremitLiquidity, {
              asset: result.toCurrency,
              amount: grossReceive,
              destinationType: 'crypto_address',
              network: q.chain,
            })
          : null;
      result.quote = buildRampFeePreview({
        sendAmount: q.amount,
        sendCurrency: result.fromCurrency,
        receiveCurrency: result.toCurrency,
        grossReceive,
        receiveDecimals: 8,
        feeQuote,
      });
    }
    sendSuccess(res, result);
  } catch (e) {
    if (e instanceof Error && e.message === 'PALREMIT_RATES_UNAVAILABLE') {
      next(new AppError('Rates unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    next(e);
  }
}

export async function createOnrampQuoteHandler(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = createOnrampQuoteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const result = await createOnrampQuote(parsed.data, {
      getQuoteFromPalremit,
      resolvePalremitNetwork: (coinCode, chainFromClient, field) =>
        resolvePalremitNetworkOrThrow(palremitLiquidity, coinCode, chainFromClient, field),
      getProviderWithdrawalFeeQuote: (input) =>
        fetchPalremitWithdrawalFeeQuote(palremitLiquidity, input),
      convertToUsdc: (from, amount) =>
        getPalremitConversionAmount(palremitCurrency, from, 'USDC', amount),
    });
    sendSuccess(res, result, 201);
  } catch (e) {
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
    if (e instanceof Error && e.message === 'PALREMIT_RATES_UNAVAILABLE') {
      next(new AppError('Rates unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'AMOUNT_TOO_LOW_AFTER_FEES') {
      next(
        new AppError(
          'Amount too low: the payout fee meets or exceeds the receive amount',
          'UNPROCESSABLE_ENTITY',
          422
        )
      );
      return;
    }
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

    let lockedQuote: OnrampQuoteSnapshot | undefined;
    let body: Omit<CreateOnrampRequest, 'requestId'>;

    if (parsed.data.quoteId) {
      const snapshot = await rampQuoteRepo.consumeRampQuote<OnrampQuoteSnapshot>(
        parsed.data.quoteId,
        'onramp'
      );
      if (!snapshot) {
        next(new AppError('Quote not found, expired, or already used', 'INVALID_REQUEST', 400));
        return;
      }
      lockedQuote = snapshot;
      body = hydrateOnrampCreateFromQuote(snapshot, {
        source: {
          userId: parsed.data.source.userId!,
          transferType: parsed.data.source.transferType,
          ...(parsed.data.source.accountId
            ? { accountId: parsed.data.source.accountId }
            : {}),
        },
        destination: {
          userId: parsed.data.destination.userId!,
          externalWalletId: parsed.data.destination.externalWalletId!,
        },
        purposeOfPayment: parsed.data.purposeOfPayment,
      });
    } else {
      body = {
        source: parsed.data.source as CreateOnrampSourceInput,
        destination: parsed.data.destination as CreateOnrampDestinationInput,
        purposeOfPayment: parsed.data.purposeOfPayment,
        platformFee: parsed.data.platformFee!,
      };
    }

    const result = await onrampCore.createOnramp(
      repos.onramp,
      repos.user,
      repos.wallet,
      repos.kyb,
      raw,
      body,
      {
        getQuoteFromPalremit,
        resolvePalremitNetwork: (coinCode, chainFromClient, field) =>
          resolvePalremitNetworkOrThrow(palremitLiquidity, coinCode, chainFromClient, field),
        createPalremitFiatDeposit: (p) => createOnrampPalremitFiatDeposit(palremitLiquidity, p),
        listOnrampAccounts: (userId) => findOnrampAccountsByUser(userId),
        getProviderWithdrawalFeeQuote: (input) =>
          fetchPalremitWithdrawalFeeQuote(palremitLiquidity, input),
        convertToUsdc: (from, amount) =>
          getPalremitConversionAmount(palremitCurrency, from, 'USDC', amount),
        ...(lockedQuote ? { lockedQuote } : {}),
      }
    );
    sendSuccess(res, result, 201);
  } catch (e) {
    if (e instanceof Error && e.message === 'USER_NOT_FOUND') {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    if (e instanceof Error && e.message === 'USER_NOT_KYB_VERIFIED') {
      next(new AppError('User not KYB verified for this currency', 'UNPROCESSABLE_ENTITY', 422));
      return;
    }
    if (e instanceof Error && e.message === 'WALLET_NOT_FOUND') {
      next(new AppError('Wallet not found', 'NOT_FOUND', 404));
      return;
    }
    if (e instanceof Error && e.message === 'AMOUNT_TOO_LOW_AFTER_FEES') {
      next(
        new AppError(
          'Amount too low: the payout fee meets or exceeds the receive amount',
          'UNPROCESSABLE_ENTITY',
          422
        )
      );
      return;
    }
    if (e instanceof Error && e.message === 'SOURCE_DESTINATION_USER_MISMATCH') {
      next(new AppError('Source and destination userId must match', 'INVALID_REQUEST', 400));
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_RATES_UNAVAILABLE') {
      next(new AppError('Rates unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_ONRAMP_WITHDRAWAL_FAILED') {
      next(new AppError('Crypto withdrawal failed', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'USER_EMAIL_REQUIRED_FOR_ONRAMP') {
      next(
        new AppError(
          'User business profile must include email for fiat deposit',
          'UNPROCESSABLE_ENTITY',
          422
        )
      );
      return;
    }
    if (e instanceof Error && e.message === 'ONRAMP_ACCOUNT_NOT_FOUND') {
      next(
        new AppError(
          'source.accountId must be an onramp Account id for this user',
          'UNPROCESSABLE_ENTITY',
          422,
          { field: 'source.accountId' }
        )
      );
      return;
    }
    if (e instanceof GraphOnrampKycError) {
      next(
        new AppError(e.message, 'UNPROCESSABLE_ENTITY', 422, {
          missingFields: e.missingFields,
          fieldErrors: e.fieldErrors,
          code: e.code,
        })
      );
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_FIAT_DEPOSIT_FAILED') {
      next(new AppError('Fiat deposit instructions failed', 'BAD_GATEWAY', 502));
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
    if (e instanceof Error && e.message === 'PALREMIT_COIN_UNAVAILABLE') {
      next(new AppError('Coin metadata unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'QUOTE_CURRENCY_MISMATCH') {
      next(new AppError('Quote currencies do not match the create request', 'INVALID_REQUEST', 400));
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
    await onrampCore.advanceOnrampIfFiatProcessed(
      { findOnrampById: repos.onramp.findOnrampById, updateOnrampStatus: onrampRepo.updateOnrampStatus },
      onrampId,
      (b, rid, receiveNet, destAddr, txnRef, destMemo) =>
        executePalremitOnrampCryptoWithdrawal(
          palremitLiquidity,
          b,
          rid,
          receiveNet,
          destAddr,
          txnRef,
          destMemo
        )
    );
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
