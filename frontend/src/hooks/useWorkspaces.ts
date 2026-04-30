import { useCallback, useEffect, useState } from 'react';
import { Instance } from '../types';
import {
  getInstances,
  setActiveInstance,
  setActiveInstanceIdLocal,
  subscribeActiveInstance,
  getActiveInstanceId,
} from '../api/instances';
import { getCurrentUsername, subscribeUsername } from '../api/auth';

export function useWorkspaces() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [activeInstanceId, setActiveInstanceIdState] = useState<string | null>(() => getActiveInstanceId());
  const [currentUser, setCurrentUser] = useState<string | null>(() => getCurrentUsername());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { instances: list, activeInstanceId: serverActive } = await getInstances();
      setInstances(list);
      // Prefer server's active id; fall back to local if server doesn't have one yet
      const resolved = serverActive ?? getActiveInstanceId();
      setActiveInstanceIdState(resolved);
      if (resolved) setActiveInstanceIdLocal(resolved);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  // Same-tab propagation: listen for changes to the active id
  useEffect(() => {
    return subscribeActiveInstance((id) => setActiveInstanceIdState(id));
  }, []);

  // Track current user so isActiveOwner stays live across login/logout
  useEffect(() => {
    return subscribeUsername((u) => setCurrentUser(u));
  }, []);

  const switchTo = useCallback(async (id: string) => {
    setActiveInstanceIdLocal(id);  // immediate local update + notify
    setActiveInstanceIdState(id);
    try {
      await setActiveInstance(id);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Defaults to false while instances haven't loaded yet, preventing a
  // momentary flash of delete buttons for non-owner members.
  const isActiveOwner: boolean =
    currentUser !== null &&
    activeInstanceId !== null &&
    (instances.find((i) => i.id === activeInstanceId)?.owner === currentUser) === true;

  return { instances, activeInstanceId, loading, error, refresh, switchTo, isActiveOwner };
}
