/**
 * HTTP client wrapper for LP calls. Used by /core/integrations only.
 * No business logic; just request/response with optional timeout and headers.
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
 * Send HTTP request and parse JSON response. Throws on non-2xx or network error.
 */
export async function httpRequest<T = unknown>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const { method = 'GET', headers = {}, body, timeoutMs = 30000 } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    signal: controller.signal,
  };
  if (body !== undefined && method !== 'GET') {
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, init);
    const outHeaders: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      outHeaders[k] = v;
    });
    let data: T;
    const text = await res.text();
    try {
      data = text ? (JSON.parse(text) as T) : (undefined as T);
    } catch {
      data = text as unknown as T;
    }
    clearTimeout(timeout);
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${res.statusText}`) as Error & {
        status: number;
        data: T;
      };
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return { status: res.status, headers: outHeaders, data };
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error) throw e;
    throw new Error(String(e));
  }
}
