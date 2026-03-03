import Redis from 'ioredis';
import { env } from '../config';

let redis: Redis | null = null;

/**
 * Get Redis client (singleton). Used by idempotency and rate limit middleware.
 */
export function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
  }
  return redis;
}

/**
 * Close Redis connection (e.g. on shutdown).
 */
export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
