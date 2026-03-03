import type { Request, Response, NextFunction } from 'express';
import { AppError, type ErrorResponseBody } from '../types/errors';

/**
 * Normalize all errors to { success: false, error: { code, message } }.
 * No stack traces or raw DB errors in response.
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let statusCode = 500;

  if (err instanceof AppError) {
    code = err.code;
    message = err.message;
    statusCode = err.statusCode;
  } else if (err instanceof Error) {
    message = err.message;
    // Zod validation errors etc. can be passed via next(err) with status
    const status = (err as Error & { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 600) {
      statusCode = status;
      if (statusCode === 400) code = 'VALIDATION_ERROR';
    }
  }

  const body: ErrorResponseBody = {
    success: false,
    error: { code, message },
  };

  res.status(statusCode).json(body);
}
