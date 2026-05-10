import { useEffect, useState } from 'react';
import { getCurrentDisplayName, getCurrentUsername, subscribeUsername } from '../api/auth';
import { storage } from '../utils/storage';

/**
 * Friendly name for display in greetings/welcome banners. Falls back to the
 * username when no display name is set. Recomputes on cross-tab storage events
 * (e.g. another tab finishing login) and on same-tab username changes.
 */
export function useDisplayName(): string | null {
  function read(): string | null {
    return getCurrentDisplayName() || getCurrentUsername();
  }
  const [name, setName] = useState<string | null>(read);
  useEffect(() => {
    const refresh = () => setName(read());
    const unsubscribeStorage = storage.subscribe(refresh);
    const unsubscribe = subscribeUsername(refresh);
    return () => {
      unsubscribeStorage();
      unsubscribe();
    };
  }, []);
  return name;
}
