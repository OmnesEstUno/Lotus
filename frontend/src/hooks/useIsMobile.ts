import { useEffect, useState } from 'react';

const QUERY = '(max-width: 639px)';

/**
 * Tracks whether the viewport is below the 640px mobile breakpoint. The same
 * 640px boundary the rest of the app uses for the navbar grid, FAB sizing,
 * and workspace surface differentiation.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
