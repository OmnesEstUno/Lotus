import { useCallback, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { colorForId } from '../../utils/workspaceColor';
import { useEdgeSwipe } from '../../hooks/useEdgeSwipe';
import EdgePanel from './EdgePanel';
import WorkspacePanelBody from './WorkspacePanelBody';

/**
 * Mobile workspace stripe — 8px-wide gradient stripe flush against the
 * handedness-aware screen edge. Tap or inward-swipe to open the workspace
 * panel. Hidden when fewer than 2 workspaces exist.
 */
export default function WorkspaceStripe() {
  const { instances, activeInstanceId } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleOpen = useCallback(() => setOpen(true), []);
  useEdgeSwipe(buttonRef, { onTrigger: handleOpen });

  if (instances.length < 2) return null;

  const active = instances.find((i) => i.id === activeInstanceId);
  const color = active ? colorForId(active.id) : 'var(--accent)';
  const style: CSSProperties = { ['--stripe-color' as never]: color };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="edge-stripe edge-stripe--workspace"
        style={style}
        onClick={() => setOpen(true)}
        aria-label="Switch workspace"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg
          className="edge-stripe-glyph"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          {/* Workspaces glyph — 4 stacked rectangles. */}
          <path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zM3 14h7v7H3v-7zm11 0h7v7h-7v-7z" />
        </svg>
        <span className="edge-stripe-bar" aria-hidden="true" />
      </button>
      <EdgePanel
        open={open}
        onClose={() => setOpen(false)}
        side="right"
        width="138px"
        accentColor={color}
        ariaLabel="Workspaces"
      >
        <WorkspacePanelBody onDone={() => setOpen(false)} />
      </EdgePanel>
    </>
  );
}
