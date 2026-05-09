/**
 * User context attached by auth middleware to req.user.
 */
export interface AuthUser {
  /** Auth method used. */
  authMethod: 'api_key';
}
