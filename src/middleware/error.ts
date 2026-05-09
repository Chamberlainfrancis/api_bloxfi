import type { Request, Response, NextFunction } from 'express';
import { AppError, type ErrorResponseBody, type ErrorDetails } from '@/types/errors';

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
    const httpErr = err as Error & {
      statusCode?: number;
      status?: number;
      data?: unknown;
    };
    const multerCode = (err as Error & { code?: string }).code;
    const httpStatus = httpErr.statusCode ?? httpErr.status;
    if (multerCode === 'LIMIT_FILE_SIZE') {
      statusCode = 400;
      code = 'INVALID_REQUEST';
      message = 'File size exceeds maximum allowed (10MB)';
    } else if (httpStatus && httpStatus >= 400 && httpStatus < 600) {
      statusCode = httpStatus;
      if (statusCode === 400) code = 'INVALID_REQUEST';
      else if (statusCode === 404) code = 'NOT_FOUND';
      else if (statusCode === 422) code = 'UNPROCESSABLE_ENTITY';
      else if (statusCode === 401 || statusCode === 403) code = 'UNAUTHORIZED';
      else if (statusCode >= 502) code = 'BAD_GATEWAY';
      const d = httpErr.data;
      if (d && typeof d === 'object' && !Array.isArray(d)) {
        const o = d as Record<string, unknown>;
        const upstreamMsg =
          typeof o.message === 'string'
            ? o.message.trim()
            : typeof o.error === 'string'
              ? o.error.trim()
              : '';
        if (upstreamMsg) message = upstreamMsg;
      }
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
