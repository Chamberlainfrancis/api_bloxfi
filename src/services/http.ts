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

export type HttpError<T = unknown> = Error & {
  status: number;
  statusCode: number;
  data: T;
  headers?: Record<string, string>;
};

/** True when `httpRequest` threw after a non-2xx response (includes parsed `data` body). */
export function isHttpError<T = unknown>(e: unknown): e is HttpError<T> {
  return (
    e instanceof Error &&
    typeof (e as HttpError).status === 'number' &&
    typeof (e as HttpError).statusCode === 'number'
  );
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
      const err = new Error(`HTTP ${res.status}: ${res.statusText}`) as HttpError<T>;
      err.status = res.status;
      err.statusCode = res.status;
      err.data = data;
      err.headers = outHeaders;
      throw err;
    }
    return { status: res.status, headers: outHeaders, data };
  } catch (e) {
    clearTimeout(timeout);
    if (e instanceof Error) throw e;
    throw new Error(String(e));
  }
}
