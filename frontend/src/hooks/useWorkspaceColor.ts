// frontend/src/hooks/useWorkspaceColor.ts
import { useEffect, useState } from 'react';
import type { Instance } from '../types';
import { colorForInstance } from '../utils/workspaceColor';
import { getPendingColor, subscribePendingColor } from '../utils/pendingColors';

/**
 * Returns the color that should be rendered for the given instance — pending
 * draft color (during a live picker session) takes priority over the persisted
 * color, which in turn beats the hash-derived fallback.
 */
export function useWorkspaceColor(inst: Instance | null | undefined): string {
  const [, setTick] = useState(0);
  useEffect(() => subscribePendingColor(() => setTick((t) => t + 1)), []);
  if (!inst) return 'var(--accent)';
  return getPendingColor(inst.id) ?? colorForInstance(inst);
}
