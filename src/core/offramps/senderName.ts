// Payout originator display label for an off-ramp. Precedence:
//   1. providerRefs.senderInfo.senderName — ops setting resolved when the
//      offramp was created (core/admin/senderInfo).
//   2. providerRefs.palremitOrchestrator.senderName — stored at fiat initiation.
//   3. receipt.withdrawal.sender_name — completed/failed receipt.
// null when unknown or for manually completed payouts. Informational only.
function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function senderNameFromRow(
  providerRefs: unknown,
  receipt: Record<string, unknown> | null,
): string | null {
  const refs = asRecord(providerRefs);
  const fromSetting = nonBlank(asRecord(refs?.senderInfo)?.senderName);
  if (fromSetting) return fromSetting;
  const fromOrchestrator = nonBlank(asRecord(refs?.palremitOrchestrator)?.senderName);
  if (fromOrchestrator) return fromOrchestrator;
  return nonBlank(asRecord(receipt?.withdrawal)?.sender_name);
}
