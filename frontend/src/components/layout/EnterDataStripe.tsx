import { useCallback, useEffect } from 'react';
import { useDataEntry } from '../../contexts/DataEntryContext';
import { useStripeDragController } from '../../hooks/useStripeDragController';

// Compute panel width at drag time. We use 92vw → approximate with window.innerWidth * 0.92.
function computePanelWidth(): number {
  return window.innerWidth * 0.92;
}

/**
 * Mobile Enter Data stripe — 8px-wide accent-color gradient stripe at the
 * bottom of the handedness-aware edge. Tap or inward-swipe opens the data
 * entry panel (the same DataEntryContext-driven panel desktop uses, only
 * rendered inside an EdgePanel on mobile).
 */
export default function EnterDataStripe() {
  const { isOpen, open, setDragOffset, setIsDragging } = useDataEntry();

  const handleCommit = useCallback(() => open(), [open]);
  const handleCancel = useCallback(() => {}, []);
  const { attachRef, dragOffset, isDragging } = useStripeDragController({
    panelWidth: computePanelWidth(),
    onCommit: handleCommit,
    onCancel: handleCancel,
  });

  // Mirror hook state into context so the context's EdgePanel renders accordingly.
  useEffect(() => { setDragOffset(dragOffset); }, [dragOffset, setDragOffset]);
  useEffect(() => { setIsDragging(isDragging); }, [isDragging, setIsDragging]);

  return (
    <button
      ref={attachRef}
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
