import { useEffect, useState } from 'react';
import { getCurrentUsername, subscribeUsername } from '../api/client';
import { storage } from '../utils/storage';

export function useCurrentUser(): string | null {
  const [username, setUsername] = useState<string | null>(() => getCurrentUsername());
  useEffect(() => {
    // Cross-tab: storage event fires when another tab writes to localStorage
    const onStorage = () => setUsername(getCurrentUsername());
    const unsubscribeStorage = storage.subscribe(onStorage);

    // Same-tab: subscribeUsername fires when verify2FA or logout runs in this tab
    const unsubscribe = subscribeUsername(setUsername);

    return () => {
      unsubscribeStorage();
      unsubscribe();
    };
  }, []);
  return username;
}
