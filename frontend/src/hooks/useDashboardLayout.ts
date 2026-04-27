import { useEffect, useState, useCallback } from 'react';
import { STORAGE_KEYS } from '../utils/constants';
import { storage } from '../utils/storage';

const CARD_IDS = [
  'spending-trends',
  'expenses-by-category',
  'income-vs-expenditures',
  'avg-expenditures',
  'all-transactions',
] as const;
export type CardId = (typeof CARD_IDS)[number];

export const CARD_LABELS: Record<CardId, string> = {
  'spending-trends': 'Spending Trends',
  'expenses-by-category': 'Expenses by Category',
  'income-vs-expenditures': 'Income vs. Expenditures',
  'avg-expenditures': 'Average Monthly Expenditures',
  'all-transactions': 'All Transactions',
};


function reconcileOrder(saved: string[] | null): CardId[] {
  if (!saved) return [...CARD_IDS];
  const valid = saved.filter((id): id is CardId => (CARD_IDS as readonly string[]).includes(id));
  const missing = CARD_IDS.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
}

function readSet(key: string): Set<CardId> {
  try {
    const raw = storage.get(key);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(parsed.filter((id): id is CardId => (CARD_IDS as readonly string[]).includes(id)));
  } catch {
    return new Set();
  }
}

export function useDashboardLayout(instanceId: string | null | undefined) {
  const [cardOrder, setCardOrderState] = useState<CardId[]>([...CARD_IDS]);
  const [minimized, setMinimizedState] = useState<Set<CardId>>(new Set());
  const [hidden, setHiddenState] = useState<Set<CardId>>(new Set());

  // Load persisted state whenever the active workspace changes.
  useEffect(() => {
    if (!instanceId) return;
    try {
      const raw = storage.get(STORAGE_KEYS.DASHBOARD_ORDER(instanceId));
      setCardOrderState(reconcileOrder(raw ? (JSON.parse(raw) as string[]) : null));
    } catch {
      setCardOrderState([...CARD_IDS]);
    }
    setMinimizedState(readSet(STORAGE_KEYS.DASHBOARD_MINIMIZED(instanceId)));
    setHiddenState(readSet(STORAGE_KEYS.HIDDEN(instanceId)));
  }, [instanceId]);

  // Writes happen synchronously inside setters (not useEffects) to avoid
  // the initial-mount clobber pattern where a save effect fires before the
  // load effect has set state.

  const setCardOrder = useCallback(
    (update: CardId[] | ((prev: CardId[]) => CardId[])) => {
      setCardOrderState((prev) => {
        const next = typeof update === 'function' ? update(prev) : update;
        if (instanceId) {
          storage.set(STORAGE_KEYS.DASHBOARD_ORDER(instanceId), JSON.stringify(next));
        }
        return next;
      });
    },
    [instanceId],
  );

  const toggleMinimized = useCallback(
    (id: CardId) => {
      setMinimizedState((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (instanceId) {
          storage.set(STORAGE_KEYS.DASHBOARD_MINIMIZED(instanceId), JSON.stringify([...next]));
        }
        return next;
      });
    },
    [instanceId],
  );

  const toggleHidden = useCallback(
    (id: CardId) => {
      setHiddenState((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        if (instanceId) {
          storage.set(STORAGE_KEYS.HIDDEN(instanceId), JSON.stringify([...next]));
        }
        return next;
      });
    },
    [instanceId],
  );

  return { cardOrder, setCardOrder, minimized, toggleMinimized, hidden, toggleHidden };
}
