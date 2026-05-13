import { useEffect, useRef } from 'react';
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
  children: ReactNode;
}

const SWIPE_BACK_THRESHOLD = 80;     // px outward drag to dismiss
const SWIPE_BACK_FLING_VELOCITY = 0.5; // px/ms

export default function EdgePanel({
  open, onClose, onBackdropClose,
  side, width, accentColor, ariaLabel, children,
}: EdgePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; t: number; delta: number } | null>(null);

  function effectiveSide(): 'left' | 'right' {
    // Mobile CSS flips side="right" to the left edge under data-handedness="left".
    // The flip is the SAME @media query EdgePanel's CSS uses (max-width: 639px).
    if (side !== 'right') return side;
    if (typeof window === 'undefined') return side;
    const isNarrow = window.matchMedia('(max-width: 639px)').matches;
    if (!isNarrow) return side;
    const handedness = document.documentElement.dataset.handedness ?? 'right';
    return handedness === 'left' ? 'left' : 'right';
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first focusable inside the panel.
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

  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length !== 1) return;
    dragRef.current = { x: e.touches[0].clientX, t: Date.now(), delta: 0 };
  }
  function handleTouchMove(e: React.TouchEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.touches[0].clientX - d.x;
    // Outward = toward the edge the panel came from.
    // Right-anchored panel → outward = +X (rightward)
    // Left-anchored panel  → outward = -X (leftward)
    const eff = effectiveSide();
    const outward = eff === 'right' ? dx : -dx;
    d.delta = outward;
    // Apply a transient drag offset for tactile feedback.
    if (panelRef.current && outward > 0) {
      panelRef.current.style.transform =
        `translateX(${eff === 'right' ? outward : -outward}px)`;
    }
  }
  function handleTouchEnd() {
    const d = dragRef.current;
    if (!d) return;
    const elapsed = Date.now() - d.t;
    const velocity = elapsed > 0 ? d.delta / elapsed : 0;
    if (panelRef.current) panelRef.current.style.transform = '';
    dragRef.current = null;
    if (d.delta > SWIPE_BACK_THRESHOLD || velocity > SWIPE_BACK_FLING_VELOCITY) {
      onClose();
    }
  }

  if (!open) return null;

  const handleBackdrop = onBackdropClose ?? onClose;
  const style: CSSProperties = {
    width,
    // Custom property consumed by .edge-panel::before for the gradient color.
    ['--edge-panel-accent' as never]: accentColor,
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
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
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
