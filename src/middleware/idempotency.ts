import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../services/redis';
import { env } from '../config';
import { AppError } from '../types/errors';

const REQUEST_ID_HEADER = 'requestid';

/**
 * For POST/PUT state-changing routes: require requestId header, Redis-backed uniqueness.
 * Duplicate requestId → 409 with standard error (no cached response).
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers[REQUEST_ID_HEADER];
  const raw = Array.isArray(requestId) ? requestId[0] : requestId;

  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
    return;
  }

  const key = `idempotency:${raw.trim()}`;
  const ttl = env.IDEMPOTENCY_TTL_SECONDS;
  const redis = getRedis();

  redis
    .set(key, '1', 'EX', ttl, 'NX')
    .then((ok) => {
      if (ok === 'OK') {
        next();
      } else {
        next(new AppError('Duplicate requestId; request is canceled', 'CONFLICT', 409));
      }
    })
    .catch((err) => {
      next(err instanceof Error ? err : new AppError('Service unavailable', 'SERVICE_UNAVAILABLE', 503));
    });
}
