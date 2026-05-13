import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface EdgePanelProps {
  open: boolean;
  /** Called by Escape, the panel's own close button, or a swipe-back gesture. */
  onClose: () => void;
  /** Called by a backdrop click. Defaults to onClose. */
  onBackdropClose?: () => void;
  /** Which screen edge the panel anchors to. Desktop callers always pass 'left';
   *  mobile callers always pass 'right' — CSS flips it to the left edge under
   *  [data-handedness="left"]. */
  side: 'left' | 'right';
  /** CSS width — e.g. '220px', '138px', '92%'. */
  width: string;
  /** Color used for the inner-edge gradient (CSS color or var). */
  accentColor: string;
  /** Used as the accessible name on the panel's role="dialog" element. */
  ariaLabel: string;
  /**
   * External drag offset (px from fully-open). 0 = open, panelWidth = closed.
   * Provided by a stripe's drag controller during open-drag. When provided,
   * the panel tracks this value.
   */
  dragOffset?: number | null;
  /**
   * Whether the external drag is actively in progress. When true, transition is
   * suppressed so the panel tracks the finger exactly.
   */
  isDragging?: boolean;
  children: ReactNode;
}

const SWIPE_BACK_FLING_VELOCITY = 0.5; // px/ms — release-velocity threshold for fling-close
const ANIMATION_DURATION_MS = 220;     // matches CSS .edge-panel transition

export default function EdgePanel({
  open, onClose, onBackdropClose,
  side, width, accentColor, ariaLabel,
  dragOffset, isDragging,
  children,
}: EdgePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Internal close-swipe state (user swiping the open panel back to dismiss).
  const [internalDragOffset, setInternalDragOffset] = useState<number | null>(null);
  const [internalIsDragging, setInternalIsDragging] = useState(false);

  // Slide-in state: if no external drag is initiating this mount, start the
  // panel off-screen and transition to translateX(0) on the next frame.
  // This replaces the CSS @keyframes-based slide-in (which had a re-trigger
  // bug when inline `animation: none` was removed after a drag commit).
  const [mountSlide, setMountSlide] = useState<'off' | 'on' | null>(() => {
    if (typeof window === 'undefined') return null;
    // If a drag is initiating the mount, skip the slide-in entirely —
    // dragOffset drives the position from the start.
    if (dragOffset != null || isDragging) return null;
    return 'off';
  });

  // On mount, if we started in 'off' state, advance to 'on' on the next frame
  // so the CSS transition fires from off-screen to translateX(0).
  useEffect(() => {
    if (mountSlide !== 'off') return;
    const id = requestAnimationFrame(() => {
      setMountSlide('on');
      // After the transition, clear the inline override so the panel rests
      // at its default transform.
      window.setTimeout(() => setMountSlide(null), ANIMATION_DURATION_MS + 16);
    });
    return () => cancelAnimationFrame(id);
    // Run once on mount; mountSlide's lazy initializer already captured the
    // correct starting state from the props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function effectiveSide(): 'left' | 'right' {
    if (side !== 'right') return side;
    if (typeof window === 'undefined') return side;
    const isNarrow = window.matchMedia('(max-width: 639px)').matches;
    if (!isNarrow) return side;
    const handedness = document.documentElement.dataset.handedness ?? 'right';
    return handedness === 'left' ? 'left' : 'right';
  }

  // Keyboard / focus / body-scroll effect (unchanged behaviour).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const root = panelRef.current;
    if (root) {
      const first = root.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      first?.focus();
    }

    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Native touch listeners for internal close-swipe (non-passive touchmove so
  // we can preventDefault). Re-attaches when `dragOffset` flips between
  // null/non-null so the guard inside onTouchStart stays current.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    // `started` = touchstart fired. `dragging` = movement passed the threshold
    // and we're actively following the finger. Mirrors the open-drag controller.
    const dragState = { startX: 0, startT: 0, started: false, dragging: false };
    const MOVEMENT_THRESHOLD = 8;

    const onTouchStart = (e: TouchEvent) => {
      // If the stripe's open-drag is in progress, don't start a close-drag.
      if (dragOffset != null) return;
      if (e.touches.length !== 1) return;
      dragState.startX = e.touches[0].clientX;
      dragState.startT = Date.now();
      dragState.started = true;
      dragState.dragging = false;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragState.started) return;
      const dx = e.touches[0].clientX - dragState.startX;
      const eff = effectiveSide();
      // "outward" = away from the interior, toward the screen edge.
      const outward = eff === 'right' ? dx : -dx;

      if (!dragState.dragging) {
        // Wait for the user to commit to a drag before claiming the gesture.
        // Matches the open-drag controller's 8px threshold.
        if (outward < MOVEMENT_THRESHOLD) return;
        dragState.dragging = true;
        setInternalIsDragging(true);
      }

      // Claim the gesture so the browser doesn't (iOS back-swipe etc.).
      e.preventDefault();

      // Follow the finger in both directions; clamp to >= 0 so reversing past
      // the start point pulls the panel back to fully open rather than letting
      // it travel "inside" the rest position.
      setInternalDragOffset(Math.max(0, outward));
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!dragState.started) return;
      const wasDragging = dragState.dragging;
      dragState.started = false;
      dragState.dragging = false;

      // If we never crossed the movement threshold, it was a tap on something
      // inside the panel — leave it alone (no transform to clean up).
      if (!wasDragging) return;

      const elapsed = Date.now() - dragState.startT;
      const dx = e.changedTouches[0].clientX - dragState.startX;
      const eff = effectiveSide();
      const outward = eff === 'right' ? dx : -dx;
      const velocity = elapsed > 0 ? outward / elapsed : 0;

      setInternalIsDragging(false);

      const pw = panelRef.current?.offsetWidth ?? 300;
      // Close if dragged past the panel's halfway point, or if released with
      // enough outward velocity. Matches the open-drag controller's threshold.
      if (outward > pw / 4 || velocity > SWIPE_BACK_FLING_VELOCITY) {
        setInternalDragOffset(pw);
        window.setTimeout(() => {
          onClose();
          setInternalDragOffset(null);
        }, ANIMATION_DURATION_MS);
      } else {
        setInternalDragOffset(0);
        window.setTimeout(() => setInternalDragOffset(null), ANIMATION_DURATION_MS);
      }
    };

    const onTouchCancel = () => {
      if (!dragState.started) return;
      const wasDragging = dragState.dragging;
      dragState.started = false;
      dragState.dragging = false;
      if (!wasDragging) return;
      setInternalIsDragging(false);
      setInternalDragOffset(0);
      window.setTimeout(() => setInternalDragOffset(null), ANIMATION_DURATION_MS);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchCancel);

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, dragOffset]);

  if (!open) return null;

  // Resolve effective drag state. Either source may drive the transform —
  // external props (an open-drag from the stripe controller) take priority
  // when they're active (i.e., dragOffset is a number), otherwise fall back
  // to the panel's internal close-drag state. The earlier "external defined"
  // check was wrong because parents always pass `dragOffset={null}` during
  // idle state, which masked internalDragOffset during close-drags.
  const effOffset = dragOffset ?? internalDragOffset;
  const effDragging = isDragging === true || internalIsDragging;

  const handleBackdrop = onBackdropClose ?? onClose;

  // Build the inline transform. Priority:
  //   1. Active drag (external or internal) — track the offset.
  //   2. Mount slide-in 'off' state — pin to off-screen (no transition).
  //   3. Otherwise — no inline transform; default 0 + CSS transition.
  let transformValue: string | undefined;
  let transitionValue: string | undefined;
  if (effOffset != null) {
    transformValue = `translateX(${effOffset}px)`;
    transitionValue = effDragging ? 'none' : `transform ${ANIMATION_DURATION_MS}ms ease-out`;
  } else if (mountSlide === 'off') {
    // First paint: off-screen, no transition (browser won't animate from
    // here yet because the value hasn't changed). Next frame, mountSlide
    // flips to 'on' and we drop the inline transform — the CSS transition
    // on the cascade animates from this off-screen value back to 0.
    transformValue = `translateX(${effectiveSide() === 'right' ? '100%' : '-100%'})`;
    transitionValue = 'none';
  }

  const style: CSSProperties = {
    width,
    ['--edge-panel-accent' as never]: accentColor,
    ...(transformValue != null
      ? { transform: transformValue, ...(transitionValue ? { transition: transitionValue } : {}) }
      : {}),
  };

  return (
    <div
      className="edge-panel-backdrop"
      onClick={handleBackdrop}
      role="presentation"
    >
      <div
        ref={panelRef}
        className={`edge-panel edge-panel--${side}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="edge-panel-close"
          onClick={onClose}
          aria-label="Close"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        {children}
      </div>
    </div>
  );
}
