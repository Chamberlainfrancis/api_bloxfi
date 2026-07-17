/**
 * Fetch a remote document URL and store a copy in S3 (same bucket/rules as file upload).
 */

import {
  isAllowedMimeType,
  storeFile,
  MAX_FILE_SIZE_BYTES,
  type AllowedMimeType,
  type StoreResult,
} from '@/services/storage';

const FETCH_TIMEOUT_MS = 30_000;

export class RemoteDocumentError extends Error {
  constructor(
    message: string,
    readonly code: 'INVALID_URL' | 'FETCH_FAILED' | 'UNSUPPORTED_TYPE' | 'TOO_LARGE'
  ) {
    super(message);
    this.name = 'RemoteDocumentError';
  }
}

function assertHttpsUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new RemoteDocumentError('sourceOfFundsDocument must be a valid URL', 'INVALID_URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new RemoteDocumentError('sourceOfFundsDocument must use https', 'INVALID_URL');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    throw new RemoteDocumentError('sourceOfFundsDocument host is not allowed', 'INVALID_URL');
  }
  return parsed;
}

function guessMimeFromContentType(header: string | null): string | null {
  if (!header) return null;
  return header.split(';')[0]?.trim().toLowerCase() ?? null;
}

function guessMimeFromUrl(url: URL): AllowedMimeType | null {
  const path = url.pathname.toLowerCase();
  if (path.endsWith('.pdf')) return 'application/pdf';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.png')) return 'image/png';
  return null;
}

/**
 * Download `https://…` document and PutObject into configured S3 bucket.
 */
export async function copyRemoteDocumentToS3(documentUrl: string): Promise<StoreResult> {
  const url = assertHttpsUrl(documentUrl);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { Accept: 'application/pdf,image/jpeg,image/png,*/*' },
    });
  } catch {
    throw new RemoteDocumentError('Failed to download sourceOfFundsDocument', 'FETCH_FAILED');
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new RemoteDocumentError(
      `Failed to download sourceOfFundsDocument (HTTP ${res.status})`,
      'FETCH_FAILED'
    );
  }

  const contentLength = res.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_FILE_SIZE_BYTES) {
    throw new RemoteDocumentError('sourceOfFundsDocument exceeds 10MB', 'TOO_LARGE');
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_FILE_SIZE_BYTES) {
    throw new RemoteDocumentError('sourceOfFundsDocument exceeds 10MB', 'TOO_LARGE');
  }
  if (buf.length === 0) {
    throw new RemoteDocumentError('sourceOfFundsDocument is empty', 'FETCH_FAILED');
  }

  const headerMime = guessMimeFromContentType(res.headers.get('content-type'));
  const mime =
    (headerMime && isAllowedMimeType(headerMime) ? headerMime : null) ??
    guessMimeFromUrl(url);
  if (!mime || !isAllowedMimeType(mime)) {
    throw new RemoteDocumentError(
      'sourceOfFundsDocument must be PDF, JPEG, or PNG',
      'UNSUPPORTED_TYPE'
    );
  }

  const originalFilename = url.pathname.split('/').pop() || `sof-document${mimeToExt(mime)}`;
  return storeFile(buf, originalFilename, mime);
}

function mimeToExt(mime: AllowedMimeType): string {
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  return '.bin';
}
