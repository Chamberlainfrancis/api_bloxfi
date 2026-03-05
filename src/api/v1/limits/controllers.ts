/**
 * Limits and high-value-request controllers. Spec §6.
 */

import type { Request, Response, NextFunction } from 'express';
import { sendSuccess } from '../../../utils';
import { AppError } from '../../../types';
import * as limitsCore from '../../../core/limits';
import * as highValueRequestRepo from '../../../db/repositories/highValueRequest.repo';
import * as userRepo from '../../../db/repositories/user.repo';
import { createHighValueRequestBodySchema } from './schemas';

const REQUEST_ID_HEADER = 'requestid';

function validationError(message: string, details?: unknown): AppError {
  return new AppError(message, 'INVALID_REQUEST', 400, details as Record<string, unknown>);
}

export async function getLimits(
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = limitsCore.getLimits();
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function getUserLimits(
  req: Request<{ userId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { userId } = req.params;
    const platformLimits = limitsCore.getLimits();
    const result = await limitsCore.getUserLimits(
      { findUserById: userRepo.findUserById },
      userId,
      { platformRails: platformLimits.rails }
    );
    if (!result) {
      next(new AppError('User not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}

export async function createHighValueRequest(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const requestIdRaw = req.headers[REQUEST_ID_HEADER];
    const raw = Array.isArray(requestIdRaw) ? requestIdRaw[0] : requestIdRaw;
    if (!raw || typeof raw !== 'string' || raw.trim() === '') {
      next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
      return;
    }
    const parsed = createHighValueRequestBodySchema.safeParse(req.body);
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
    const { requestId: _r, ...body } = parsed.data;
    const result = await limitsCore.createHighValueRequest(
      highValueRequestRepo,
      raw,
      body
    );
    sendSuccess(res, result, 201);
  } catch (e) {
    next(e);
  }
}

export async function getHighValueRequest(
  req: Request<{ requestId: string }>,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { requestId } = req.params;
    const result = await limitsCore.getHighValueRequest(highValueRequestRepo, requestId);
    if (!result) {
      next(new AppError('High-value request not found', 'NOT_FOUND', 404));
      return;
    }
    sendSuccess(res, result);
  } catch (e) {
    next(e);
  }
}
