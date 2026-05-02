import { useEffect, useState } from 'react';

/**
 * Returns true when the viewport width is below the given breakpoint.
 * Default 640 matches the rest of the app's mobile breakpoint.
 */
export function useIsNarrow(breakpoint: number = 640): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(() =>
    typeof window !== 'undefined' && window.innerWidth < breakpoint,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsNarrow(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [breakpoint]);
  return isNarrow;
}
