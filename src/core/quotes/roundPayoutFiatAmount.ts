/**
 * ISO-4217 minor units for dest-fixed payout quotes.
 * OwlPay JP BANK-TRANSFER 400s fractional yen (2026-09-07: 1534322.39 fails,
 * 1534322 succeeds).
 */
const ZERO_DECIMAL_ISO4217 = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

export function payoutFiatDecimals(asset: string): number {
  return ZERO_DECIMAL_ISO4217.has(asset.trim().toUpperCase()) ? 0 : 2;
}

export function roundPayoutFiatAmount(asset: string, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  const decimals = payoutFiatDecimals(asset);
  const f = 10 ** decimals;
  return Math.round(amount * f) / f;
}
