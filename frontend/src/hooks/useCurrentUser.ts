import { useEffect, useState } from 'react';
import { getCurrentUsername, subscribeUsername } from '../api/client';

export function useCurrentUser(): string | null {
  const [username, setUsername] = useState<string | null>(() => getCurrentUsername());
  useEffect(() => {
    // Cross-tab: storage event fires when another tab writes to localStorage
    const onStorage = () => setUsername(getCurrentUsername());
    window.addEventListener('storage', onStorage);

    // Same-tab: subscribeUsername fires when verify2FA or logout runs in this tab
    const unsubscribe = subscribeUsername(setUsername);

    return () => {
      window.removeEventListener('storage', onStorage);
      unsubscribe();
    };
  }, []);
  return username;
}
