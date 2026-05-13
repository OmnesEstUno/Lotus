/**
 * Stable per-workspace color derived from the workspace UUID. The desktop
 * spine, mobile stripes, and pills inside the workspace panel all call this
 * so the surfaces match.
 */
export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return `hsl(${h}, 60%, 55%)`;
}
