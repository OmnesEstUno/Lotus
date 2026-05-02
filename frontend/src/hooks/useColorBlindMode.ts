import { useSyncExternalStore } from 'react';
import { getColorBlindMode, subscribeColorBlindMode } from '../utils/categorization/colors';

/**
 * Subscribes the calling component to the color-blind chart palette flag.
 * Returns the current flag value. Use this in any component that calls
 * `getCategoryColor()` in its render so it re-renders when the user toggles
 * the setting (the flag itself lives in module scope, not React state).
 */
export function useColorBlindMode(): boolean {
  return useSyncExternalStore(subscribeColorBlindMode, getColorBlindMode);
}
