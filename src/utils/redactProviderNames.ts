/**
 * Strip liquidity / KYC provider brand names from partner-facing error text.
 * Admin/ops surfaces should not use this — they need real provider names.
 */

const PROVIDER_NAME_RE =
  /\b(Palremit|SwipeLux|Swipelux|OwlPay|Owlpay|Yativo|Bancara|Graph|Sumsub|Kuda)\b/gi;

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
