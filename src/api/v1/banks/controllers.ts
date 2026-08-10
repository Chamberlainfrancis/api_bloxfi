/**
 * GET /api/v1/banks — Palremit GET /v1/banks (supported banks per **fiat** payout asset).
 * POST /api/v1/banks/resolve — partner JSON camelCase; upstream Palremit snake_case. **200:** `data` has `bankCode`, `bankName`, `accountNumber`, `accountName` only (no Palremit `data` wrapper).
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { isHttpError } from '@/services/http';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import {
  listPalremitBanksForAsset,
  resolvePalremitBankAccount,
} from '@/core/integrations/palremitBanks';
import { listBanksQuerySchema, resolveBankBodySchema } from '@/api/v1/banks/schemas';
import { logger } from '@/lib/logger';

const palremitLiquidity = createPalremitLiquidityAdapter();

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

function palremitClientErrorMessage(data: unknown): string {
  if (data != null && typeof data === 'object' && !Array.isArray(data)) {
    const o = data as Record<string, unknown>;
    const msg = o.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
    const err = o.error;
    if (typeof err === 'string' && err.trim()) return err.trim();
  }
  return 'Request rejected by liquidity provider';
}

export async function listBanks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const parsed = listBanksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const asset = parsed.data.asset.trim().toUpperCase();
    const banks = await listPalremitBanksForAsset(palremitLiquidity, asset);
    sendSuccess(res, { asset, banks });
  } catch (e) {
    if (isHttpError(e)) {
      if (e.status === 400) {
        next(validationError(palremitClientErrorMessage(e.data)));
        return;
      }
      next(new AppError('Banks unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_BANKS_INVALID_RESPONSE') {
      next(new AppError('Banks response invalid', 'BAD_GATEWAY', 502));
      return;
    }
    next(e);
  }
}

export async function resolveBankAccount(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = resolveBankBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const message = parsed.error.errors.map((er) => `${er.path.join('.')}: ${er.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { asset, bankCode, accountNumber } = parsed.data;
    const resolution = await resolvePalremitBankAccount(palremitLiquidity, {
      asset: asset.trim(),
      bankCode: bankCode.trim(),
      accountNumber: accountNumber.trim(),
    });
    sendSuccess(res, { ...resolution });
  } catch (e) {
    if (isHttpError(e)) {
      const dataKeys =
        e.data != null && typeof e.data === 'object' && !Array.isArray(e.data)
          ? Object.keys(e.data as object)
          : [];
      if (e.status === 400) {
        logger.warn({
          status: e.status,
          dataKeys,
          message: palremitClientErrorMessage(e.data),
        }, 'api/v1/banks/resolve Palremit HTTP 400');
        next(validationError(palremitClientErrorMessage(e.data)));
        return;
      }
      logger.error({
        status: e.status,
        dataKeys,
        errorMessage: e.message,
      }, 'api/v1/banks/resolve Palremit HTTP error');
      next(new AppError('Bank resolve unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    if (e instanceof Error && e.message === 'PALREMIT_BANK_RESOLVE_INVALID_RESPONSE') {
      logger.error({ message: e.message }, 'api/v1/banks/resolve upstream body invalid');
      next(new AppError('Bank resolve response invalid', 'BAD_GATEWAY', 502));
      return;
    }
    logger.error({ err: e }, 'api/v1/banks/resolve unexpected error');
    next(e);
  }
}
