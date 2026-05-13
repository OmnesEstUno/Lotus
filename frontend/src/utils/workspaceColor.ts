/**
 * Stable per-workspace color derived from the workspace UUID. Used only as
 * a fallback when an instance has no explicit `color` set.
 */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 55%)`;
}

/**
 * Resolve the color shown for an instance: the owner-set color if one exists,
 * otherwise the hash-derived fallback.
 */
export function colorForInstance(inst: { id: string; color?: string }): string {
  return inst.color ?? colorForId(inst.id);
}
