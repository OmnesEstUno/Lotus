import { useCallback, useEffect, useState } from 'react';

export interface ListWithActionsAPI<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  runAction: (action: () => Promise<void>) => Promise<void>;
}

/**
 * Wraps a list resource with refresh + per-item action helpers.
 *
 * `fetcher` is called on mount and whenever the consumer calls `refresh()`.
 * `runAction` runs an arbitrary mutation, then refreshes the list (or
 * surfaces an error via `error`). Use it for actions like delete, unarchive, etc.
 *
 * NOTE: wrap the `fetcher` argument in `useCallback` at the call site. If you
 * pass an inline lambda it will be recreated each render, causing the internal
 * `refresh` callback to invalidate and potentially cause stale-closure issues.
 * The initial fetch fires once on mount (the `useEffect` dep array is
 * intentionally empty); subsequent fetches are explicit via `refresh()`.
 */
export function useListWithActions<T>(fetcher: () => Promise<T[]>): ListWithActionsAPI<T> {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetcher());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }, [refresh]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { items, loading, error, refresh, runAction };
}
