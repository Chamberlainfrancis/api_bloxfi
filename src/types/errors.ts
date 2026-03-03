/**
 * Error response shape per bloxfi-liquidity-provider-integration-spec-v1.0.0.md
 * and bloxfi-api-partners.pdf: top-level "error" with code, message, optional details/requestId/timestamp.
 */

/** Field-level validation entry (for details array). */
export interface ErrorDetailField {
  field: string;
  message: string;
}

/**
 * Details can be an array of field errors (validation) or an object with extra context (e.g. INSUFFICIENT_BALANCE).
 */
export type ErrorDetails = ErrorDetailField[] | Record<string, unknown>;

export interface ErrorResponsePayload {
  code: string;
  message: string;
  details?: ErrorDetails;
  requestId?: string;
  timestamp?: string;
  retryable?: boolean;
}

/** Spec-compliant error response body: top-level "error" only (no success: false). */
export interface ErrorResponseBody {
  error: ErrorResponsePayload;
}

/**
 * Custom error for HTTP responses. Used by error middleware to set status and build spec-compliant body.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: ErrorDetails,
    public readonly retryable?: boolean
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}
