import type { Response } from 'express';

export interface SuccessResponseBody<T> {
  success: true;
  data: T;
}

/**
 * Send standardized success response: { success: true, data }.
 */
export function sendSuccess<T>(res: Response, data: T, statusCode: number = 200): void {
  const body: SuccessResponseBody<T> = { success: true, data };
  res.status(statusCode).json(body);
}
