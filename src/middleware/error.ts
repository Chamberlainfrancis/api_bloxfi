import type { Request, Response, NextFunction } from 'express';
import { AppError, type ErrorResponseBody, type ErrorDetails } from '../types/errors';

const REQUEST_ID_HEADER = 'requestid';

/**
 * Normalize all errors to spec format: { error: { code, message, details?, requestId?, timestamp } }.
 * No stack traces or raw DB errors in response.
 * Per docs/bloxfi-liquidity-provider-integration-spec-v1.0.0.md and bloxfi-api-partners.pdf.
 */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let statusCode = 500;
  let details: ErrorDetails | undefined;
  let retryable: boolean | undefined;

  if (err instanceof AppError) {
    code = err.code;
    message = err.message;
    statusCode = err.statusCode;
    details = err.details;
    retryable = err.retryable;
  } else if (err instanceof Error) {
    message = err.message;
    const status = (err as Error & { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 600) {
      statusCode = status;
      if (statusCode === 400) code = 'INVALID_REQUEST';
    }
  }

  const requestId = req.headers[REQUEST_ID_HEADER];
  const requestIdStr = Array.isArray(requestId) ? requestId[0] : requestId;

  const body: ErrorResponseBody = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      ...(typeof requestIdStr === 'string' && requestIdStr.trim() && { requestId: requestIdStr.trim() }),
      timestamp: new Date().toISOString(),
      ...(retryable !== undefined && { retryable }),
    },
  };

  res.status(statusCode).json(body);
}
