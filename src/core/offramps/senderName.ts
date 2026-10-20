// Payout originator display label for an off-ramp: stored at fiat initiation
// (providerRefs.palremitOrchestrator.senderName), with the completed/failed
// receipt (receipt.withdrawal.sender_name) as fallback. null when unknown or
// for manually completed payouts. Informational only.
export function senderNameFromRow(
  providerRefs: unknown,
  receipt: Record<string, unknown> | null,
): string | null {
  if (providerRefs != null && typeof providerRefs === 'object' && !Array.isArray(providerRefs)) {
    const orch = (providerRefs as Record<string, unknown>).palremitOrchestrator;
    if (orch != null && typeof orch === 'object' && !Array.isArray(orch)) {
      const v = (orch as Record<string, unknown>).senderName;
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  const w = receipt?.withdrawal;
  if (w != null && typeof w === 'object' && !Array.isArray(w)) {
    const v = (w as Record<string, unknown>).sender_name;
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}
