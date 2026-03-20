/** Deterministic JSON for idempotent payload comparison (key order independent). */

export function sortJsonDeep(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortJsonDeep);
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    out[k] = sortJsonDeep(obj[k]);
  }
  return out;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(sortJsonDeep(value));
}
