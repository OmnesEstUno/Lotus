import { useEffect } from 'react';
import type { RefObject } from 'react';

interface EdgeSwipeOptions {
  /** Called when the user performs an inward swipe on the element. */
  onTrigger: () => void;
  /** Minimum inward delta in px to count as a swipe. Defaults to 40. */
  threshold?: number;
  /**
   * When true, also fires for short-but-fast inward swipes (≥20px in ≤250ms).
   * Defaults to true.
   */
  allowFling?: boolean;
}

/**
 * Detects an inward horizontal swipe on the given element. Reads the
 * [data-handedness] attribute on `<html>` to decide which way "inward" is:
 * right-handed → leftward; left-handed → rightward. The stripes use this
 * to support pull-to-reveal on touch devices.
 */
export function useEdgeSwipe(
  ref: RefObject<HTMLElement>,
  { onTrigger, threshold = 40, allowFling = true }: EdgeSwipeOptions,
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let startX = 0;
    let startT = 0;
    let dragging = false;

    function onStart(e: TouchEvent) {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startT = Date.now();
      dragging = true;
    }
    function onEnd(e: TouchEvent) {
      if (!dragging) return;
      dragging = false;
      const dx = e.changedTouches[0].clientX - startX;
      const dt = Date.now() - startT;
      const handedness = document.documentElement.dataset.handedness ?? 'right';
      // "inward" is opposite of the screen edge the control lives on:
      // right-handed → control is on the right edge → inward = -X (leftward)
      const inwardDx = handedness === 'right' ? -dx : dx;
      const isLongSwipe = inwardDx > threshold;
      const isFling = allowFling && inwardDx > 20 && dt < 250;
      if (isLongSwipe || isFling) onTrigger();
    }

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchend', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchend', onEnd);
    };
  }, [ref, onTrigger, threshold, allowFling]);
}
