/**
 * Deep-merge a partial Palremit destination patch into an existing stored destination.
 * Used by PUT account so clients can supply only missing fields (e.g. beneficiary.email).
 */

function record(v: unknown): Record<string, unknown> | undefined {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

export function mergePalremitDestination(
  base: Record<string, unknown>,
  patch: Record<string, unknown>
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;

  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;

    if (key === 'beneficiary') {
      const patchBen = record(value);
      if (!patchBen) {
        out.beneficiary = value;
        continue;
      }
      const baseBen = record(out.beneficiary) ?? {};
      const mergedBen: Record<string, unknown> = { ...baseBen, ...patchBen };
      const patchAddr = record(patchBen.address);
      if (patchAddr) {
        mergedBen.address = { ...(record(baseBen.address) ?? {}), ...patchAddr };
      }
      out.beneficiary = mergedBen;
      continue;
    }

    if (key === 'extras') {
      const patchExtras = record(value);
      if (!patchExtras) {
        out.extras = value;
        continue;
      }
      out.extras = { ...(record(out.extras) ?? {}), ...patchExtras };
      continue;
    }

    out[key] = value;
  }

  return out;
}
