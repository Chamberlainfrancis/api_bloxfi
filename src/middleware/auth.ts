import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config';
import { AppError } from '../types/errors';
import type { AuthUser, ApiKeyValidationResult } from '../types/auth';

const API_KEY_LENGTH = 32;
const BEARER_PREFIX = 'Bearer ';

export type ValidateApiKeyFn = (token: string) => Promise<ApiKeyValidationResult | null>;

export interface AuthMiddlewareOptions {
  /** Validate 32-char API key against DB. If not provided, API key auth is disabled (only JWT). */
  validateApiKey?: ValidateApiKeyFn;
}

/**
 * Validate JWT or 32-char Bearer API key (DB-backed when validateApiKey is provided).
 * Reject malformed Authorization; set req.user.
 */
export function authMiddleware(options: AuthMiddlewareOptions = {}) {
  const { validateApiKey } = options;

  return async function auth(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const raw = req.headers.authorization;
    if (!raw || typeof raw !== 'string') {
      next(new AppError('Missing or invalid Authorization header', 'UNAUTHORIZED', 401));
      return;
    }

    if (!raw.startsWith(BEARER_PREFIX)) {
      next(new AppError('Authorization must be Bearer <token>', 'UNAUTHORIZED', 401));
      return;
    }

    const token = raw.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      next(new AppError('Missing Bearer token', 'UNAUTHORIZED', 401));
      return;
    }

    // 32-char API key: validate against DB when validator is provided
    if (token.length === API_KEY_LENGTH && /^[a-zA-Z0-9]+$/.test(token)) {
      if (!validateApiKey) {
        next(new AppError('API key authentication is not configured', 'UNAUTHORIZED', 401));
        return;
      }
      try {
        const key = await validateApiKey(token);
        if (!key) {
          next(new AppError('Invalid or inactive API key', 'UNAUTHORIZED', 401));
          return;
        }
        req.user = {
          apiKeyId: key.partnerId,
          partnerId: key.partnerId,
          keyPrefix: key.keyPrefix,
          authMethod: 'api_key',
        };
        next();
        return;
      } catch {
        next(new AppError('Authentication failed', 'UNAUTHORIZED', 401));
        return;
      }
    }

    // JWT
    try {
      const decoded = jwt.verify(token, env.JWT_SECRET) as { sub?: string; userId?: string };
      const userId = decoded.sub ?? decoded.userId;
      if (!userId || typeof userId !== 'string') {
        next(new AppError('Invalid token payload', 'UNAUTHORIZED', 401));
        return;
      }
      req.user = {
        userId,
        authMethod: 'jwt',
      };
      next();
    } catch {
      next(new AppError('Invalid or expired token', 'UNAUTHORIZED', 401));
    }
  };
}
