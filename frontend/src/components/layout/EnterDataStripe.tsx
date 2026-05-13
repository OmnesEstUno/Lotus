import { useRef } from 'react';
import { useDataEntry } from '../../contexts/DataEntryContext';
import { useEdgeSwipe } from '../../hooks/useEdgeSwipe';

/**
 * Mobile Enter Data stripe — 8px-wide accent-color gradient stripe at the
 * bottom of the handedness-aware edge. Tap or inward-swipe opens the data
 * entry panel (the same DataEntryContext-driven panel desktop uses, only
 * rendered inside an EdgePanel on mobile).
 */
export default function EnterDataStripe() {
  const { open } = useDataEntry();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEdgeSwipe(buttonRef, { onTrigger: open });

  return (
    <button
      ref={buttonRef}
      type="button"
      className="edge-stripe edge-stripe--enter-data"
      onClick={open}
      aria-label="Enter data"
      aria-haspopup="dialog"
    >
      <svg
        className="edge-stripe-glyph"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        {/* Document-with-plus glyph — matches the existing FAB icon shape. */}
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
        <path
          d="M12 12v6M9 15h6"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
      <span className="edge-stripe-bar" aria-hidden="true" />
    </button>
  );
}
