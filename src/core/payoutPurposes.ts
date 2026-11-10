/**
 * Bloxfi payout-purpose policy, applied on top of Palremit/OwlPay corridor requirements.
 *
 * - Self transfers are not offered: `extras.is_self_transfer` is hidden from corridor
 *   requirements, `true` is rejected, and every withdrawal is sent with `false`.
 * - `TRANSFER_TO_OWN_ACCOUNT` and `SALARY` are not offered as transfer purposes.
 * - Extra business purposes are offered under Bloxfi codes and translated to the
 *   closest OwlPay `transfer_purpose` code when the withdrawal is sent.
 *   OwlPay's enum is fixed (28 codes); it takes no free-text purpose.
 */

/** Purposes Bloxfi clients may not use, on accounts or offramps. */
export const BLOCKED_TRANSFER_PURPOSES: ReadonlySet<string> = new Set([
  'TRANSFER_TO_OWN_ACCOUNT',
  'SALARY',
]);

export interface BloxfiPurposeOption {
  /** Code the Bloxfi client sends (`destination.purposeOfPayment` / `extras.transfer_purpose`). */
  value: string;
  label: string;
  /** OwlPay `transfer_purpose` sent to Palremit. */
  providerCode: string;
}

/**
 * Business purposes offered to Bloxfi clients. Where OwlPay has the exact code the
 * Bloxfi code is the OwlPay code (only the label changes); the others are Bloxfi
 * aliases that map to the nearest OwlPay code.
 */
export const BLOXFI_PURPOSE_OPTIONS: readonly BloxfiPurposeOption[] = [
  { value: 'REPRESENTATIVE_EXPENSES', label: "Representative's Expense", providerCode: 'REPRESENTATIVE_EXPENSES' },
  { value: 'ADVISOR_FEES', label: 'Business Advisory Fees', providerCode: 'ADVISOR_FEES' },
  { value: 'INFO_SERVICE', label: 'Infotech Service Fees', providerCode: 'INFO_SERVICE' },
  { value: 'PROFESSIONAL_FEES', label: 'Professional Fees', providerCode: 'ADVISOR_FEES' },
  { value: 'GRAPHICS_DESIGN_BRANDING_FEES', label: 'Graphics Design & Branding Fees', providerCode: 'ADVERTISING' },
  { value: 'MARKET_RESEARCH_DEVELOPMENT', label: 'Market Research & Development', providerCode: 'ADVERTISING' },
  { value: 'TRAINING_DEVELOPMENT_FEES', label: 'Training and Development Fees', providerCode: 'EDUCATION' },
];

const OPTION_BY_VALUE = new Map(BLOXFI_PURPOSE_OPTIONS.map((o) => [o.value, o]));

function normalizeCode(purpose: string): string {
  return purpose.trim().toUpperCase();
}

/** Error message when a purpose is not allowed for Bloxfi clients, else null. */
export function blockedPurposeError(purpose: unknown): string | null {
  if (typeof purpose !== 'string' || !purpose.trim()) return null;
  const code = normalizeCode(purpose);
  if (!BLOCKED_TRANSFER_PURPOSES.has(code)) return null;
  return `purpose '${code}' is not supported`;
}

/** Bloxfi purpose code → OwlPay transfer_purpose (unchanged when not an alias). */
export function toProviderTransferPurpose(purpose: string): string {
  const option = OPTION_BY_VALUE.get(normalizeCode(purpose));
  return option ? option.providerCode : purpose;
}

/** Error message when a destination asks for a self transfer, else null. */
export function selfTransferError(extras: unknown): string | null {
  if (extras == null || typeof extras !== 'object' || Array.isArray(extras)) return null;
  const e = extras as Record<string, unknown>;
  if (e.is_self_transfer === true || e.isSelfTransfer === true) {
    return 'self transfers are not supported';
  }
  return null;
}

/** Validate a client destination's extras against the Bloxfi purpose policy. */
export function destinationPurposeErrors(
  destination: Record<string, unknown>
): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = [];
  const extras = destination.extras;
  const selfErr = selfTransferError(extras);
  if (selfErr) errors.push({ path: 'extras.is_self_transfer', message: selfErr });
  if (extras != null && typeof extras === 'object' && !Array.isArray(extras)) {
    const purposeErr = blockedPurposeError((extras as Record<string, unknown>).transfer_purpose);
    if (purposeErr) errors.push({ path: 'extras.transfer_purpose', message: purposeErr });
  }
  return errors;
}

type EnumChoice = { value: string | number | boolean; label?: string };

function applyPurposeEnum(choices: EnumChoice[]): EnumChoice[] {
  const offered = new Set(choices.map((c) => String(c.value)));
  const out: EnumChoice[] = choices
    .filter((c) => !BLOCKED_TRANSFER_PURPOSES.has(String(c.value)))
    .map((c) => {
      const option = OPTION_BY_VALUE.get(String(c.value));
      return option ? { ...c, label: option.label } : c;
    });
  for (const option of BLOXFI_PURPOSE_OPTIONS) {
    // Add aliases only when the corridor accepts the OwlPay code they map to.
    if (offered.has(option.value)) continue;
    if (!offered.has(option.providerCode)) continue;
    out.push({ value: option.value, label: option.label });
  }
  return out;
}

interface FieldLike {
  path: string;
  enum?: EnumChoice[];
  conditional_required?: Array<{ enum?: EnumChoice[] } & Record<string, unknown>>;
}

/** Corridor requirement fields as offered to Bloxfi clients. */
export function applyPurposePolicyToFields<T extends FieldLike>(fields: T[]): T[] {
  return fields
    .filter((f) => f.path !== 'extras.is_self_transfer')
    .map((f) => {
      if (f.path !== 'extras.transfer_purpose') return f;
      const next = { ...f };
      if (f.enum) next.enum = applyPurposeEnum(f.enum);
      if (f.conditional_required) {
        next.conditional_required = f.conditional_required.map((branch) =>
          branch.enum ? { ...branch, enum: applyPurposeEnum(branch.enum) } : branch
        );
      }
      return next;
    });
}

/** Corridor destination template as offered to Bloxfi clients (no is_self_transfer). */
export function applyPurposePolicyToTemplate(
  template: Record<string, unknown>
): Record<string, unknown> {
  const extras = template.extras;
  if (extras == null || typeof extras !== 'object' || Array.isArray(extras)) return template;
  const { is_self_transfer: _drop, ...rest } = extras as Record<string, unknown>;
  const out = { ...template };
  if (Object.keys(rest).length > 0) out.extras = rest;
  else delete out.extras;
  return out;
}
