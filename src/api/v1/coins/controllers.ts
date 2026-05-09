/**
 * GET /api/v1/coins — Palremit GET /v1/coins/get_all_coins (LegacyEnvelope).
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import { createPalremitLiquidityAdapter } from '@/services/palremitAdapters';
import { listPalremitAllCoins } from '@/core/integrations/palremitLiquidity';

const palremitLiquidity = createPalremitLiquidityAdapter();

const COIN_SUMMARY_KEYS = [
  'coin_code',
  'coin_name',
  'coin_icon',
  'withdrawal_all_enabled',
  'withdrawal_fee',
  'deposit_minimum',
] as const;

function mapCoinSummary(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of COIN_SUMMARY_KEYS) {
    if (o[k] !== undefined) out[k] = o[k];
  }
  return out;
}

export async function listCoins(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await listPalremitAllCoins(palremitLiquidity);
    if (rows == null) {
      next(new AppError('Palremit coin catalogue unavailable', 'BAD_GATEWAY', 502));
      return;
    }
    sendSuccess(res, {
      coins: rows.map(mapCoinSummary),
    });
  } catch (e) {
    next(e);
  }
}
