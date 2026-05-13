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
  const { isOpen, open } = useDataEntry();
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
      aria-expanded={isOpen}
    >
      <span
        className="edge-stripe-glyph material-symbols-outlined"
        aria-hidden="true"
      >
        note_add
      </span>
      <span className="edge-stripe-bar" aria-hidden="true" />
    </button>
  );
}
