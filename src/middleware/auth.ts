import type { Request, Response, NextFunction } from 'express';
import { env } from '@/config';
import { AppError } from '@/types/errors';
import type { AuthUser } from '@/types/auth';

const BEARER_PREFIX = 'Bearer ';

/**
 * Simple Bearer secret auth.
 * - Header name is configurable via env.API_KEY_HEADER (default Authorization)
 * - Expected format: `Bearer <API_KEY>`
 */
export function authMiddleware() {
  return function auth(req: Request, _res: Response, next: NextFunction): void {
    const headerName = env.API_KEY_HEADER.toLowerCase();
    const raw = req.headers[headerName];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || typeof value !== 'string') {
      next(new AppError(`Missing or invalid ${env.API_KEY_HEADER} header`, 'UNAUTHORIZED', 401));
      return;
    }

    if (!value.startsWith(BEARER_PREFIX)) {
      next(new AppError('Authorization must be Bearer <token>', 'UNAUTHORIZED', 401));
      return;
    }

    const token = value.slice(BEARER_PREFIX.length).trim();
    if (!token) {
      next(new AppError('Missing Bearer token', 'UNAUTHORIZED', 401));
      return;
    }

    if (token !== env.API_KEY) {
      next(new AppError('Invalid API key', 'UNAUTHORIZED', 401));
      return;
    }

    const user: AuthUser = { authMethod: 'api_key' };
    req.user = user;
    next();
  };
}
