/**
 * GET /api/v1/payout-corridors — Palremit withdrawal corridor discovery.
 * GET /api/v1/payout-corridors/requirements — field spec for a selected corridor.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { isHttpError } from '@/services/http';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import {
  getPalremitWithdrawalCorridorDetail,
  listPalremitWithdrawalCorridors,
  mapPalremitCorridorDetailToApi,
  mapPalremitCorridorRowToApi,
} from '@/core/integrations/palremitCorridors';
import {
  listPayoutCorridorsQuerySchema,
  payoutCorridorRequirementsQuerySchema,
} from '@/api/v1/payout-corridors/schemas';

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

function handlePalremitCorridorError(e: unknown, next: NextFunction): void {
  if (e instanceof Error) {
    if (e.message === 'PALREMIT_CORRIDOR_UNSUPPORTED') {
      next(new AppError('Payout corridor not supported', 'NOT_FOUND', 404));
      return;
    }
    if (
      e.message === 'PALREMIT_CORRIDORS_UNAVAILABLE' ||
      e.message === 'PALREMIT_CORRIDOR_INVALID_RESPONSE'
    ) {
      next(new AppError('Payout corridors unavailable', 'BAD_GATEWAY', 502));
      return;
    }
  }
  if (isHttpError(e)) {
    if (e.status === 400) {
      next(validationError(palremitClientErrorMessage(e.data)));
      return;
    }
    if (e.status === 404) {
      next(new AppError('Payout corridor not supported', 'NOT_FOUND', 404));
      return;
    }
    next(new AppError('Payout corridors unavailable', 'BAD_GATEWAY', 502));
    return;
  }
  next(e);
}

export async function listPayoutCorridors(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = listPayoutCorridorsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((er) => `${er.path.join('.')}: ${er.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const q = parsed.data;
    const result = await listPalremitWithdrawalCorridors(palremitLiquidity, {
      asset: q.asset ?? q.targetFiat,
      country: q.country,
      destinationType: q.destinationType,
      beneficiaryType: q.beneficiaryType,
      network: q.network,
    });
    sendSuccess(res, {
      corridors: result.corridors.map(mapPalremitCorridorRowToApi),
      truncated: result.truncated ?? false,
    });
  } catch (e) {
    handlePalremitCorridorError(e, next);
  }
}

export async function getPayoutCorridorRequirements(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = payoutCorridorRequirementsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((er) => `${er.path.join('.')}: ${er.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const { asset, country, destinationType, beneficiaryType } = parsed.data;
    const detail = await getPalremitWithdrawalCorridorDetail(palremitLiquidity, {
      asset,
      country,
      destinationType,
      beneficiaryType,
    });
    sendSuccess(res, mapPalremitCorridorDetailToApi(detail));
  } catch (e) {
    handlePalremitCorridorError(e, next);
  }
}
