import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '@/services/redis';
import { env } from '@/config';
import { AppError } from '@/types/errors';

const REQUEST_ID_HEADER = 'requestid';

function routeScope(req: Request): string {
  const path = `${req.baseUrl}${req.path}`.replace(/\/+$/, '') || '/';
  return `${req.method}:${path}`;
}

/**
 * For POST/PUT state-changing routes: require requestId header, Redis-backed uniqueness.
 * Key is scoped by method+route. Duplicate requestId on the same route → 409
 * (no cached response). Failed responses (≥400) release the key so the client can retry.
 */
export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const requestId = req.headers[REQUEST_ID_HEADER];
  const raw = Array.isArray(requestId) ? requestId[0] : requestId;

  if (!raw || typeof raw !== 'string' || raw.trim() === '') {
    next(new AppError('Missing or invalid requestId header', 'BAD_REQUEST', 400));
    return;
  }

  const key = `idempotency:${routeScope(req)}:${raw.trim()}`;
  const ttl = env.IDEMPOTENCY_TTL_SECONDS;
  const redis = getRedis();

  redis
    .set(key, '1', 'EX', ttl, 'NX')
    .then((ok) => {
      if (ok === 'OK') {
        res.on('finish', () => {
          if (res.statusCode >= 400) {
            void redis.del(key);
          }
        });
        next();
      } else {
        next(new AppError('Duplicate requestId; request is canceled', 'CONFLICT', 409));
      }
    })
    .catch((err) => {
      next(err instanceof Error ? err : new AppError('Service unavailable', 'SERVICE_UNAVAILABLE', 503));
    });
}
