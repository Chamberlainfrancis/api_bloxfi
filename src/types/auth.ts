/**
 * User context attached by auth middleware to req.user.
 */
export interface AuthUser {
  /** Set when authenticated via JWT. */
  userId?: string;
  /** Set when authenticated via API key: partner/client id from DB. */
  apiKeyId?: string;
  /** Partner id when authMethod is api_key (same as apiKeyId for API key auth). */
  partnerId?: string;
  /** Key prefix for logging (e.g. first 8 chars). */
  keyPrefix?: string;
  /** Auth method used. */
  authMethod: 'jwt' | 'api_key';
}

/** Result of validating an API key against the DB. */
export interface ApiKeyValidationResult {
  partnerId: string;
  keyPrefix: string;
  environment: string;
}
