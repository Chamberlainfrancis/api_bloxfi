/**
 * OwlPay's travel-rule validation 400s withdrawal orders whose beneficiary
 * name carries "&" or punctuation jammed against the next word (observed
 * 2026-11-19: "QINGDAO HAIR NATURE ARTS&CRAFTS CO.,LIMITED" and
 * "CHONGQING LONCIN IMPORT&EXPORT CO.,LTD" both failed with
 * "Invalid value for field 'travelRule.BENEFICIARY_NAME'").
 * Normalize the stored name before the withdrawal reaches the orchestrator.
 */
export function sanitizeBeneficiaryNameForTravelRule(name: string): string {
  let out = name.replace(/\s*&\s*/g, ' AND ');
  // "CO.,LTD" → "CO., LTD": space after a comma that touches the next word.
  out = out.replace(/,(?=\S)/g, ', ');
  return out.replace(/\s+/g, ' ').trim();
}

/** Apply the travel-rule name fix to `destination.beneficiary.name` in place. */
export function sanitizeDestinationBeneficiaryName(destination: Record<string, unknown>): void {
  const ben = destination.beneficiary;
  if (ben == null || typeof ben !== 'object' || Array.isArray(ben)) return;
  const rec = ben as Record<string, unknown>;
  if (typeof rec.name !== 'string') return;
  const cleaned = sanitizeBeneficiaryNameForTravelRule(rec.name);
  if (cleaned && cleaned !== rec.name) rec.name = cleaned;
}
