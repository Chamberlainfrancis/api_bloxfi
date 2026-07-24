/**
 * Deposit account naming models for fiat onramps.
 *
 * - pooled: platform / LP shared account label (not the end customer).
 *   NGN Kuda VAs → "Palremit LTD"; USD SwipeLux → LP holder (e.g. Veem).
 * - named: VA / instructions under the user's or business name (KYC path).
 * - static: hardcoded platform receiving accounts (GBP / GHS preferred;
 *   USD on provision failure) — see staticDepositAccounts.ts.
 */

export type DepositAccountStyle = 'pooled' | 'named' | 'static';

/** Platform name used when provisioning / displaying pooled NGN (Kuda) VAs. */
export const POOLED_PLATFORM_ACCOUNT_NAME = 'Palremit LTD';

/**
 * Style for orchestrator-provisioned (dynamic) deposit accounts.
 * Static is decided separately via isPreferredStaticDepositCurrency /
 * buildStaticFallbackDepositInfo.
 */
export function dynamicDepositAccountStyle(currency: string): 'pooled' | 'named' {
  const asset = currency.trim().toUpperCase();
  // NGN: Kuda dynamic VAs under the platform name (pooled).
  // USD: SwipeLux amount-scoped pooled pay-ins (holder comes from LP).
  if (asset === 'NGN' || asset === 'USD') return 'pooled';
  return 'named';
}
