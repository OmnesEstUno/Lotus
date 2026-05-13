import { useCallback, useEffect, useRef, useState } from 'react';

interface UseStripeDragControllerOptions {
  /** Width of the panel that will be opened. Used to clamp drag offset and decide commit threshold. */
  panelWidth: number;
  /** Called when drag passes halfway on release — panel should remain open. */
  onCommit: () => void;
  /** Called when drag is below halfway on release — panel should remain closed. */
  onCancel: () => void;
}

interface UseStripeDragControllerReturn {
  /** Callback ref to attach to the stripe button. */
  attachRef: (el: HTMLButtonElement | null) => void;
  /** Current px offset from fully-open position. 0 = open, panelWidth = closed. Null when not in a drag. */
  dragOffset: number | null;
  /** True only while the user's finger is actively dragging. False during the post-release commit/cancel animation and when idle. */
  isDragging: boolean;
}

const MOVEMENT_THRESHOLD = 8;       // px inward to count as a drag (vs a tap)
const ANIMATION_DURATION_MS = 220;  // matches the CSS transition in EdgePanel

export function useStripeDragController({
  panelWidth,
  onCommit,
  onCancel,
}: UseStripeDragControllerOptions): UseStripeDragControllerReturn {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // Refs for touch state that doesn't drive renders.
  const cleanupRef = useRef<(() => void) | null>(null);
  const stateRef = useRef({
    startX: 0,
    isDragging: false,
    panelWidth,
    onCommit,
    onCancel,
  });

  // Keep stateRef synced with latest props/callbacks without re-attaching listeners.
  useEffect(() => {
    stateRef.current.panelWidth = panelWidth;
    stateRef.current.onCommit = onCommit;
    stateRef.current.onCancel = onCancel;
  }, [panelWidth, onCommit, onCancel]);

  const attachRef = useCallback((el: HTMLButtonElement | null) => {
    // Tear down listeners on previous element (if any).
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!el) return;

    const handedness = (): 'left' | 'right' =>
      (document.documentElement.dataset.handedness === 'left' ? 'left' : 'right');

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      stateRef.current.startX = e.touches[0].clientX;
      stateRef.current.isDragging = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      const dx = e.touches[0].clientX - stateRef.current.startX;
      const inward = handedness() === 'right' ? -dx : dx;

      if (!stateRef.current.isDragging) {
        if (inward < MOVEMENT_THRESHOLD) return;
        stateRef.current.isDragging = true;
        setIsDragging(true);
      }

      // Prevent browser's horizontal-pan / back-navigation gesture while dragging.
      e.preventDefault();

      const pw = stateRef.current.panelWidth;
      const offset = Math.max(0, Math.min(pw, pw - inward));
      setDragOffset(offset);
    };

    const onTouchEnd = () => {
      if (!stateRef.current.isDragging) return;  // it was a tap, not a drag — onClick handles taps
      stateRef.current.isDragging = false;
      setIsDragging(false);
      // Read the latest dragOffset from state via the setter callback to avoid stale closures.
      setDragOffset(prev => {
        if (prev == null) return null;
        const pw = stateRef.current.panelWidth;
        const past = prev < pw / 2;
        // Set target — CSS transition in EdgePanel animates from `prev` to `target`.
        const target = past ? 0 : pw;
        // After the animation completes, clear inline drag state and notify the consumer.
        window.setTimeout(() => {
          if (past) stateRef.current.onCommit();
          else stateRef.current.onCancel();
          setDragOffset(null);
        }, ANIMATION_DURATION_MS);
        return target;
      });
    };

    const onTouchCancel = () => {
      // OS interrupted the gesture (call, system swipe). Snap back without firing onCommit.
      if (!stateRef.current.isDragging) return;
      stateRef.current.isDragging = false;
      setIsDragging(false);
      setDragOffset(prev => {
        if (prev == null) return null;
        window.setTimeout(() => {
          stateRef.current.onCancel();
          setDragOffset(null);
        }, ANIMATION_DURATION_MS);
        return stateRef.current.panelWidth;
      });
    };

    // touchstart and touchend are passive (no preventDefault needed).
    // touchmove must be non-passive so preventDefault() actually suppresses scroll.
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);

    cleanupRef.current = () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
  }, []);

  // Final cleanup on unmount.
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  return { attachRef, dragOffset, isDragging };
}
