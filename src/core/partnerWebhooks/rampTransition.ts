export function shouldEmitRampEvent<T extends string>(
  previousStatus: string | null,
  nextStatus: string,
  map: (s: string) => T | null
): T | null {
  const next = map(nextStatus);
  if (!next) return null;
  const prev = previousStatus == null ? null : map(previousStatus);
  if (prev === next) return null;
  return next;
}
