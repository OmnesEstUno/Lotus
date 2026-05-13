// frontend/src/utils/pendingColors.ts
type Listener = () => void;
const pending = new Map<string, string>();
const listeners = new Set<Listener>();

export function getPendingColor(id: string): string | undefined {
  return pending.get(id);
}

export function setPendingColor(id: string, color: string | null): void {
  if (color == null) pending.delete(id);
  else pending.set(id, color);
  listeners.forEach((fn) => fn());
}

export function subscribePendingColor(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
