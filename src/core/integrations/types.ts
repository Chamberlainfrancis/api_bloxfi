/**
 * Types for LP (liquidity provider) integration. Core receives an HTTP client via DI;
 * implementation lives in /services. User creation is not delegated to LPs.
 */

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Record<string, string>;
  data: T;
}

/**
 * LP HTTP client interface. Injected into core/integrations; implemented by services/lpClient.
 * Used for future onramp/offramp (and other) LP calls — not for user creation.
 */
export interface LpHttpClient {
  request<T = unknown>(path: string, options?: HttpRequestOptions): Promise<HttpResponse<T>>;
}
