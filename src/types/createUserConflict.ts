/**
 * POST /users conflicts: duplicate business email or requestId reused with different payload → HTTP 409.
 */
export class CreateUserConflictError extends Error {
  constructor(
    public readonly kind: 'EMAIL_EXISTS' | 'REQUEST_ID_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'CreateUserConflictError';
    Object.setPrototypeOf(this, CreateUserConflictError.prototype);
  }
}
