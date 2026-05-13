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
   * the panel tracks this value instead of rendering via the slide-in animation.
   */
  dragOffset?: number | null;
  /**
   * Whether the external drag is actively in progress. When true, transition is
   * suppressed so the panel tracks the finger exactly.
   */
  isDragging?: boolean;
  children: ReactNode;
}

const SWIPE_BACK_THRESHOLD = 80;       // px outward drag to dismiss
const SWIPE_BACK_FLING_VELOCITY = 0.5; // px/ms
const ANIMATION_DURATION_MS = 220;     // matches the CSS transition used for drag settle

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

  // Native touch listeners for internal close-swipe (non-passive touchmove so we can preventDefault).
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;

    const dragState = { startX: 0, startT: 0, active: false };

    const onTouchStart = (e: TouchEvent) => {
      // If the stripe's open-drag is in progress, don't start a close-drag.
      if (dragOffset != null) return;
      if (e.touches.length !== 1) return;
      dragState.startX = e.touches[0].clientX;
      dragState.startT = Date.now();
      dragState.active = true;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragState.active) return;
      const dx = e.touches[0].clientX - dragState.startX;
      const eff = effectiveSide();
      // "outward" = away from the interior of the screen, toward the screen edge.
      const outward = eff === 'right' ? dx : -dx;
      if (outward <= 0) return;
      e.preventDefault();
      setInternalIsDragging(true);
      setInternalDragOffset(outward);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!dragState.active) return;
      dragState.active = false;
      const elapsed = Date.now() - dragState.startT;
      const dx = e.changedTouches[0].clientX - dragState.startX;
      const eff = effectiveSide();
      const outward = eff === 'right' ? dx : -dx;
      const velocity = elapsed > 0 ? outward / elapsed : 0;

      setInternalIsDragging(false);

      if (outward > SWIPE_BACK_THRESHOLD || velocity > SWIPE_BACK_FLING_VELOCITY) {
        // Commit dismiss: animate to panelWidth then call onClose.
        const pw = panelRef.current?.offsetWidth ?? 300;
        setInternalDragOffset(pw);
        window.setTimeout(() => {
          onClose();
          setInternalDragOffset(null);
        }, ANIMATION_DURATION_MS);
      } else {
        // Cancel: animate back to 0 then clear.
        setInternalDragOffset(0);
        window.setTimeout(() => setInternalDragOffset(null), ANIMATION_DURATION_MS);
      }
    };

    const onTouchCancel = () => {
      if (!dragState.active) return;
      dragState.active = false;
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
    // dragOffset in deps so the guard inside onTouchStart stays current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, dragOffset]);

  if (!open) return null;

  // Resolve effective drag state: external props take priority over internal.
  const effOffset = dragOffset !== undefined ? dragOffset : internalDragOffset;
  const effDragging = isDragging !== undefined ? isDragging : internalIsDragging;

  const handleBackdrop = onBackdropClose ?? onClose;

  const style: CSSProperties = {
    width,
    ['--edge-panel-accent' as never]: accentColor,
    ...(effOffset != null ? {
      transform: `translateX(${effOffset}px)`,
      transition: effDragging ? 'none' : `transform ${ANIMATION_DURATION_MS}ms ease-out`,
      animation: 'none',
    } : {}),
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
