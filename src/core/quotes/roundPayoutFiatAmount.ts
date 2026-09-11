/**
 * ISO-4217 minor units for dest-fixed payout quotes.
 * OwlPay JP BANK-TRANSFER 400s fractional yen (2026-09-07: 1534322.39 fails,
 * 1534322 succeeds).
 *
 * EUR is ISO 2-decimal; Harbor accepts cents. BloxFi still ceils EUR offramp
 * receive to whole euros so the locked dest amount (and the bank credit) has
 * no fractional part. Palremit absorbs up to €0.99 from the EUR sell spread.
 */
const ZERO_DECIMAL_ISO4217 = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF',
  'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

function assetCode(asset: string): string {
  return asset.trim().toUpperCase();
}

export function payoutFiatDecimals(asset: string): number {
  const code = assetCode(asset);
  if (code === 'EUR') return 0;
  return ZERO_DECIMAL_ISO4217.has(code) ? 0 : 2;
}

export function roundPayoutFiatAmount(asset: string, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return amount;
  const code = assetCode(asset);
  if (code === 'EUR') {
    // Snap to cents first so 870.0000001 does not become 871.
    return Math.ceil(Number(amount.toFixed(2)));
  }
  const decimals = payoutFiatDecimals(asset);
  const f = 10 ** decimals;
  return Math.round(amount * f) / f;
}
