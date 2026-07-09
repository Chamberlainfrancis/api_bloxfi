/**
 * Normalize Palremit payout destinations to the canonical snake_case shape
 * before storage and before POST /v1/withdrawals.
 *
 * Legacy OwlPay corridor discovery advertised provider wire keys (`swift_code`,
 * `routing_number`) instead of canonical `bank_code`. Stored accounts may still
 * carry those keys; active routing (e.g. AED local → Yativo) expects canonical
 * fields. This layer maps wire aliases → canonical and strips non-canonical keys
 * so provider switches do not require rewriting stored beneficiaries for naming.
 */

function str(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function record(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** Wire / legacy keys promoted into canonical `bank_code` when absent. */
const BANK_CODE_ALIASES = [
  'bank_code',
  'bankCode',
  'swift_code',
  'swiftCode',
  'routing_number',
  'routingNumber',
] as const;

/** Wire / legacy keys promoted into canonical `account_number` when absent. */
const ACCOUNT_NUMBER_ALIASES = ['account_number', 'accountNumber', 'iban', 'IBAN'] as const;

/** Keys removed after promotion — not part of the canonical destination contract. */
const STRIP_KEYS = new Set([
  'bankCode',
  'accountNumber',
  'swift_code',
  'swiftCode',
  'routing_number',
  'routingNumber',
  'iban',
  'IBAN',
  // Resolved server-side from corridor + destination_type at withdrawal time.
  'country',
  'payout_rail',
]);

function firstAliasValue(obj: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const v = str(obj[key]);
    if (v) return v;
  }
  return undefined;
}

function normalizeBeneficiary(ben: Record<string, unknown>): Record<string, unknown> {
  const out = { ...ben };
  const address = record(out.address);
  if (address) {
    const addr = { ...address };
    if (!str(addr.street) && str(addr.addressLine1)) addr.street = str(addr.addressLine1);
    if (!str(addr.postal_code) && str(addr.postalCode)) addr.postal_code = str(addr.postalCode);
    if (!str(addr.state_province) && str(addr.stateProvinceRegion)) {
      addr.state_province = str(addr.stateProvinceRegion);
    }
    delete addr.addressLine1;
    delete addr.postalCode;
    delete addr.stateProvinceRegion;
    out.address = addr;
  }
  if (!str(out.phone_number) && str(out.phone)) out.phone_number = str(out.phone);
  delete out.phone;
  return out;
}

/**
 * Return a deep-cloned destination with canonical account field names.
 * Idempotent — safe to run on already-canonical payloads.
 */
export function normalizePalremitDestination(raw: Record<string, unknown>): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;

  const extras = record(out.extras);
  if (!str(out.bank_code) && extras) {
    const fromExtras = str(extras.swift_code) ?? str(extras.swiftCode);
    if (fromExtras) out.bank_code = fromExtras;
  }

  const bankCode = firstAliasValue(out, BANK_CODE_ALIASES);
  if (bankCode) out.bank_code = bankCode;

  const accountNumber = firstAliasValue(out, ACCOUNT_NUMBER_ALIASES);
  if (accountNumber) out.account_number = accountNumber;

  const ben = record(out.beneficiary);
  if (ben) out.beneficiary = normalizeBeneficiary(ben);

  for (const key of STRIP_KEYS) {
    delete out[key];
  }

  return out;
}
