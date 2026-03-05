import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '../services/redis';
import { env } from '../config';
import { AppError } from '../types/errors';

const WINDOW_SEC = env.RATE_LIMIT_WINDOW_SECONDS;
const MAX_REQUESTS = env.RATE_LIMIT_MAX_REQUESTS;
const HEADER_LIMIT = 'X-RateLimit-Limit';
const HEADER_REMAINING = 'X-RateLimit-Remaining';
const HEADER_RESET = 'X-RateLimit-Reset';

/**
 * Redis-backed rate limit (fixed window, INCR + EXPIRE). No sorted sets (zset).
 * Sets X-RateLimit-* headers; returns standard error when exceeded.
 * Key: rateLimit:{identifier} where identifier = userId or apiKeyId or IP.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const identifier = user?.userId ?? user?.apiKeyId ?? req.ip ?? 'anonymous';
  const key = `rateLimit:${identifier}`;
  const now = Math.floor(Date.now() / 1000);
  const redis = getRedis();

  redis
    .multi()
    .incr(key)
    .ttl(key)
    .exec()
    .then((results) => {
      const err0 = results?.[0]?.[0];
      const incrVal = results?.[0]?.[1];
      const ttlVal = results?.[1]?.[1];
      if (err0 || incrVal == null) {
        next(new AppError('Service unavailable', 'SERVICE_UNAVAILABLE', 503));
        return;
      }
      const current = Number(incrVal);
      const ttl = typeof ttlVal === 'number' ? ttlVal : -1;
      // Set window expiry on first request in window (ttl -1 = no expiry, -2 = key missing)
      if (ttl === -1 || ttl === -2) {
        redis.expire(key, WINDOW_SEC).catch(() => {});
      }
      const remaining = Math.max(0, MAX_REQUESTS - current);
      const reset = ttl > 0 ? now + ttl : now + WINDOW_SEC;

      res.setHeader(HEADER_LIMIT, String(MAX_REQUESTS));
      res.setHeader(HEADER_REMAINING, String(remaining));
      res.setHeader(HEADER_RESET, String(reset));

      if (current > MAX_REQUESTS) {
        next(new AppError('Rate limit exceeded', 'RATE_LIMIT_EXCEEDED', 429));
      } else {
        next();
      }
    })
    .catch((err) => {
      next(err instanceof Error ? err : new AppError('Service unavailable', 'SERVICE_UNAVAILABLE', 503));
    });
}
