/**
 * Admin dashboard controllers (NO AUTH — mounted before authMiddleware).
 * Thin: parse/validate request, delegate to core/admin/dashboard.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '@/utils';
import { AppError } from '@/types';
import * as dashboard from '@/core/admin/dashboard';

function parseType(raw: unknown): dashboard.TxnType {
  if (raw === 'onramp' || raw === 'offramp') return raw;
  throw new AppError('type must be "onramp" or "offramp"', 'INVALID_REQUEST', 400);
}

export async function listTransactions(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const type = parseType(req.query.type);
    const status =
      typeof req.query.status === 'string' && req.query.status ? req.query.status : undefined;
    if (status && !dashboard.isValidStatus(type, status)) {
      throw new AppError(`Invalid status "${status}" for ${type}`, 'INVALID_REQUEST', 400);
    }
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;
    const limitRaw = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isNaN(limitRaw) ? undefined : limitRaw;
    const result = await dashboard.listTransactions({ type, status, cursor, limit });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function getTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const type = parseType(req.params.type);
    const result = await dashboard.getTransactionDetail(type, req.params.id);
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function markTransaction(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const type = parseType(req.params.type);
    const body = (req.body ?? {}) as { outcome?: unknown; note?: unknown; actor?: unknown };
    if (body.outcome !== 'success' && body.outcome !== 'failed') {
      throw new AppError('outcome must be "success" or "failed"', 'INVALID_REQUEST', 400);
    }
    const note = typeof body.note === 'string' ? body.note : undefined;
    const actor = typeof body.actor === 'string' ? body.actor : undefined;
    const result = await dashboard.markTransaction({
      type,
      id: req.params.id,
      outcome: body.outcome,
      note,
      actor,
    });
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}
