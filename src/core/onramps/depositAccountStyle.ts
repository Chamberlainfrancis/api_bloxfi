/**
 * Deposit account naming models for fiat onramps.
 *
 * - pooled: platform / LP shared account label (not the end customer).
 *   NGN Kuda VAs → "Palremit LTD"; USD SwipeLux → LP holder (e.g. Veem).
 * - named: VA / instructions under the user's or business name (KYC path).
 * - static: hardcoded platform receiving accounts (GBP / GHS / NGN preferred;
 *   USD on provision failure) — see staticDepositAccounts.ts.
 *   NGN Wema is temporary.
 */

export type DepositAccountStyle = 'pooled' | 'named' | 'static';

/**
 * Platform label for pooled deposits when the LP holder is missing/synthetic.
 * Prefer the orchestrator's real account_holder_name when present (must match
 * bank name-enquiry).
 */
export const POOLED_PLATFORM_ACCOUNT_NAME = 'Palremit LTD';

/**
 * Kuda `provider_extras.account_name` for pooled NGN VAs.
 * Kuda always merchant-prefixes `Palremit-`, so sending "Palremit LTD" yields
 * "Palremit-Palremit LTD". Send "LTD." → issued holder "Palremit-LTD.".
 * (Bare "LTD"/"Ltd" are rejected by Kuda.)
 */
export const NGN_POOLED_KUDA_ACCOUNT_NAME = 'LTD.';

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
