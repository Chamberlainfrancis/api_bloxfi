/** Human-readable error from Palremit JSON body (envelope, problem+json, or plain string). */
export function extractPalremitErrorMessage(data: unknown): string | undefined {
  if (data == null) return undefined;
  if (typeof data === 'string') {
    const t = data.trim();
    return t || undefined;
  }
  if (typeof data !== 'object' || Array.isArray(data)) return undefined;

  const o = data as Record<string, unknown>;
  const nested =
    o.data != null && typeof o.data === 'object' && !Array.isArray(o.data)
      ? (o.data as Record<string, unknown>)
      : undefined;

  const candidates: unknown[] = [
    o.message,
    o.error,
    o.detail,
    o.title,
    nested?.message,
    nested?.error,
    nested?.detail,
  ];

  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }

  if (Array.isArray(o.errors)) {
    const parts = o.errors
      .map((item) => {
        if (typeof item === 'string' && item.trim()) return item.trim();
        if (item != null && typeof item === 'object' && !Array.isArray(item)) {
          const m = (item as Record<string, unknown>).message;
          if (typeof m === 'string' && m.trim()) return m.trim();
        }
        return '';
      })
      .filter(Boolean);
    if (parts.length > 0) return parts.join('; ');
  }

  return undefined;
}

/** Short label for logs — shown as `[Label]` in Better Stack message preview. */
export function getPalremitLogCategory(opts: {
  api: 'currency' | 'liquidity';
  method: string;
  path: string;
  idempotencyKey?: string;
}): string {
  const p = opts.path.split('?')[0].toLowerCase();

  if (opts.api === 'currency') {
    if (p.includes('conversion')) return 'Currency Conversion';
    if (p.includes('/pairs')) return 'Currency Pairs';
    return 'Palremit Currency';
  }

  if (p.includes('/v1/withdrawals/corridors')) return 'Palremit Payout Corridors';
  if (p.includes('/v1/withdrawals')) {
    const key = (opts.idempotencyKey ?? '').trim();
    if (key.startsWith('onramp-crypto-wd:')) return 'Palremit Onramp Withdrawal';
    if (key.startsWith('offramp-fiat-wd:')) return 'Palremit Offramp Withdrawal';
    return 'Palremit Withdrawal';
  }
  if (p.includes('/v1/banks/resolve')) return 'Palremit Bank Resolve';
  if (p.includes('/v1/banks')) return 'Palremit Banks';
  if (p.includes('/v1/provisioned-accounts')) return 'Palremit Provisioned Account';
  if (p.includes('/v1/deposits')) return 'Palremit Deposit';
  if (p.includes('/v1/coins/')) return 'Palremit Coins';

  return 'Palremit Liquidity';
}

/** Compact one-line Palremit response body for Pino `msg` (Better Stack list preview). */
export function formatPalremitErrorBodyForLog(data: unknown, maxLen = 2000): string | undefined {
  if (data === undefined) return undefined;
  let raw: string;
  if (typeof data === 'string') {
    raw = data.trim();
  } else {
    try {
      raw = JSON.stringify(data);
    } catch {
      return undefined;
    }
  }
  if (!raw) return undefined;
  return raw.length > maxLen ? `${raw.slice(0, maxLen)}…` : raw;
}

function formatPalremitFailureDetail(opts: {
  responseData?: unknown;
  method?: string;
  path?: string;
  httpStatus?: number;
}): string {
  const bodyMsg = formatPalremitErrorBodyForLog(opts.responseData);
  if (bodyMsg) return bodyMsg;

  const extracted = extractPalremitErrorMessage(opts.responseData);
  if (extracted) return extracted;

  if (opts.method && opts.path && opts.httpStatus != null) {
    return `${opts.method} ${opts.path} HTTP ${opts.httpStatus}`;
  }
  if (opts.method && opts.path) {
    return `${opts.method} ${opts.path} failed`;
  }
  return 'request failed';
}

/**
 * Log line message: `[Category] {full Palremit JSON}` for Better Stack list preview.
 */
export function buildPalremitFailureLogMsg(opts: {
  category: string;
  responseData?: unknown;
  method?: string;
  path?: string;
  httpStatus?: number;
}): string {
  const detail = formatPalremitFailureDetail(opts);
  return `[${opts.category}] ${detail}`;
}

/** Info/success log message with the same category prefix. */
export function buildPalremitInfoLogMsg(category: string, detail: string): string {
  return `[${category}] ${detail}`;
}
