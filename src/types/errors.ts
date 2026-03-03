/**
 * Custom error for HTTP responses. Used by error middleware to set status and normalize body.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export interface ErrorResponseBody {
  success: false;
  error: {
    code: string;
    message: string;
  };
}
