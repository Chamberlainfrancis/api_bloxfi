/**
 * Onramp POST /accounts conflicts: creationRequestId reused with a different user or identity → HTTP 409.
 * Mirrors src/types/createUserConflict.ts's CreateUserConflictError for the identical
 * requestId-reuse-with-mismatched-payload scenario (see user.repo.ts's createUser).
 */
export class CreateAccountConflictError extends Error {
  constructor(
    public readonly kind: 'REQUEST_ID_MISMATCH',
    message: string
  ) {
    super(message);
    this.name = 'CreateAccountConflictError';
    Object.setPrototypeOf(this, CreateAccountConflictError.prototype);
  }
}
