import { createHash } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { getRedis } from '@/services/redis';
import { env } from '@/config';
import { AppError } from '@/types/errors';

const WINDOW_SEC = env.RATE_LIMIT_WINDOW_SECONDS;
const MAX_REQUESTS = env.RATE_LIMIT_MAX_REQUESTS;
const HEADER_LIMIT = 'X-RateLimit-Limit';
const HEADER_REMAINING = 'X-RateLimit-Remaining';
const HEADER_RESET = 'X-RateLimit-Reset';

/**
 * Who a request counts against: the API key when one is sent (so a partner's
 * servers share one budget whatever IP they call from), otherwise the IP.
 * The key is hashed so it never lands in Redis.
 */
export function rateLimitIdentifier(req: Pick<Request, 'headers' | 'ip'>): string {
  const raw = req.headers[env.API_KEY_HEADER.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const token = typeof value === 'string' && value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  // Only the real key gets its own budget; random tokens fall back to the IP.
  if (token && token === env.API_KEY) return `key:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
  return `ip:${req.ip ?? 'anonymous'}`;
}

/**
 * Redis-backed rate limit (fixed window, INCR + EXPIRE). No sorted sets (zset).
 * Sets X-RateLimit-* headers; returns standard error when exceeded.
 * Key: rateLimit:{identifier}, see rateLimitIdentifier.
 */
export function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = `rateLimit:${rateLimitIdentifier(req)}`;
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
