import type { OfframpQuoteSnapshot } from '@/types/quote';

export function assertOfframpQuoteCorridorMatchesAccount(
  snapshot: OfframpQuoteSnapshot,
  providerPayout: unknown
): void {
  if (providerPayout == null || typeof providerPayout !== 'object' || Array.isArray(providerPayout)) {
    throw new Error('ACCOUNT_INCOMPLETE_FOR_OFFRAMP');
  }
  const pp = providerPayout as {
    corridor?: {
      country?: string;
      destinationType?: string;
      beneficiaryType?: string;
      asset?: string;
    };
  };
  const c = pp.corridor;
  if (!c?.country || !c.destinationType) {
    throw new Error('ACCOUNT_INCOMPLETE_FOR_OFFRAMP');
  }
  if (c.country.toUpperCase() !== snapshot.corridor.country.toUpperCase()) {
    throw new Error('QUOTE_CORRIDOR_MISMATCH');
  }
  if (c.destinationType !== snapshot.corridor.destinationType) {
    throw new Error('QUOTE_CORRIDOR_MISMATCH');
  }
  if (
    snapshot.corridor.beneficiaryType &&
    c.beneficiaryType &&
    c.beneficiaryType !== snapshot.corridor.beneficiaryType
  ) {
    throw new Error('QUOTE_CORRIDOR_MISMATCH');
  }
  if (c.asset && c.asset.toLowerCase() !== snapshot.toCurrency) {
    throw new Error('QUOTE_CORRIDOR_MISMATCH');
  }
}
