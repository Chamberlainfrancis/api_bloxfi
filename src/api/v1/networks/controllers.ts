/**
 * GET /api/v1/networks — Palremit-supported networks per coin (GET /coins/get_coin).
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import { fetchPalremitNetworksForCoin } from '@/core/integrations/palremitCoinNetworks';
import { listNetworksQuerySchema } from '@/api/v1/networks/schemas';

const palremitLiquidity = createPalremitLiquidityAdapter();

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function listNetworks(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const parsed = listNetworksQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      const message = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
      next(validationError(message, parsed.error.flatten()));
      return;
    }
    const coin = (parsed.data.coin ?? parsed.data.coinCode ?? '').trim();
    const coinUpper = coin.toUpperCase();
    const networks = await fetchPalremitNetworksForCoin(palremitLiquidity, coinUpper);
    if (networks == null) {
      next(new AppError('Palremit coin metadata unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    sendSuccess(res, {
      coinCode: coinUpper,
      networks: networks.map((n) => ({
        code: n.code,
        name: n.name ?? null,
        depositEnabled: n.depositEnabled ?? null,
        withdrawEnabled: n.withdrawEnabled ?? null,
      })),
    });
  } catch (e) {
    next(e);
  }
}
