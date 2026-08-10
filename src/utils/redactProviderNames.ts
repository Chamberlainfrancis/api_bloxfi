/**
 * Strip liquidity / KYC provider brand names from partner-facing error text.
 * Admin/ops surfaces should not use this — they need real provider names.
 *
 * Keep {@link PARTNER_FORBIDDEN_PROVIDER_NAMES} as the single source of truth:
 * middleware redaction, unit tests, and the partner-error leak scan all share it.
 */

/** Brands that must never appear in `/api/v1` client-facing error messages. */
export const PARTNER_FORBIDDEN_PROVIDER_NAMES = [
  'Palremit',
  'SwipeLux',
  'Swipelux',
  'OwlPay',
  'Owlpay',
  'Yativo',
  'Bancara',
  'Graph',
  'Sumsub',
  'Kuda',
] as const;

const PROVIDER_NAME_RE = new RegExp(
  `\\b(${PARTNER_FORBIDDEN_PROVIDER_NAMES.join('|')})\\b`,
  'gi'
);

export function containsProviderName(message: string): boolean {
  PROVIDER_NAME_RE.lastIndex = 0;
  return PROVIDER_NAME_RE.test(message);
}

/** Replace known provider brands with a neutral word. Idempotent. */
export function redactProviderNamesFromClientMessage(message: string): string {
  PROVIDER_NAME_RE.lastIndex = 0;
  if (!PROVIDER_NAME_RE.test(message)) return message;
  PROVIDER_NAME_RE.lastIndex = 0;
  return message.replace(PROVIDER_NAME_RE, 'provider');
}
