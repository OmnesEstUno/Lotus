import { useEffect, useState, useCallback } from 'react';

export const CARD_IDS = [
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

const orderKey = (id: string) => `dashboard:cardOrder:${id}`;
const minKey = (id: string) => `dashboard:minimized:${id}`;
const hiddenKey = (id: string) => `dashboard:hidden:${id}`;

function reconcileOrder(saved: string[] | null): CardId[] {
  if (!saved) return [...CARD_IDS];
  const valid = saved.filter((id): id is CardId => (CARD_IDS as readonly string[]).includes(id));
  const missing = CARD_IDS.filter((id) => !valid.includes(id));
  return [...valid, ...missing];
}

function readSet(key: string): Set<CardId> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as string[]) : [];
    return new Set(parsed.filter((id): id is CardId => (CARD_IDS as readonly string[]).includes(id)));
  } catch {
    return new Set();
  }
}

export function useDashboardLayout(instanceId: string | null | undefined) {
  const [cardOrder, setCardOrder] = useState<CardId[]>([...CARD_IDS]);
  const [minimized, setMinimized] = useState<Set<CardId>>(new Set());
  const [hidden, setHidden] = useState<Set<CardId>>(new Set());

  useEffect(() => {
    if (!instanceId) return;
    try {
      const raw = localStorage.getItem(orderKey(instanceId));
      setCardOrder(reconcileOrder(raw ? (JSON.parse(raw) as string[]) : null));
    } catch {
      setCardOrder([...CARD_IDS]);
    }
    setMinimized(readSet(minKey(instanceId)));
    setHidden(readSet(hiddenKey(instanceId)));
  }, [instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    localStorage.setItem(orderKey(instanceId), JSON.stringify(cardOrder));
  }, [cardOrder, instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    localStorage.setItem(minKey(instanceId), JSON.stringify([...minimized]));
  }, [minimized, instanceId]);

  useEffect(() => {
    if (!instanceId) return;
    localStorage.setItem(hiddenKey(instanceId), JSON.stringify([...hidden]));
  }, [hidden, instanceId]);

  const toggleMinimized = useCallback((id: CardId) => {
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleHidden = useCallback((id: CardId) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return { cardOrder, setCardOrder, minimized, toggleMinimized, hidden, toggleHidden };
}
