import type { OfframpDestination } from '@/types/offramp';

function maskDigits(value: string, lastVisible: number): string {
  const t = String(value ?? '').replace(/\s+/g, '');
  if (!t) return '';
  if (t.length <= lastVisible) return '****';
  return `****${t.slice(-lastVisible)}`;
}

function maskMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const m = { ...meta };
  for (const key of ['accountNumber', 'bankCode', 'account_number', 'bank_code'] as const) {
    if (typeof m[key] === 'string') m[key] = maskDigits(m[key] as string, 4);
  }
  return m;
}

/**
 * Redacts payout secrets before returning offramp destination in API responses.
 * Full values remain on the persisted JSON row for payout/retry.
 */
export function maskPublicOfframpDestination(dest: OfframpDestination): OfframpDestination {
  if (!dest.metadata) return dest;
  return {
    ...dest,
    metadata: maskMetadata(dest.metadata),
  };
}
