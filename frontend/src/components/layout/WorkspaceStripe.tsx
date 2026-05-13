import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useWorkspaceColor } from '../../hooks/useWorkspaceColor';
import { useStripeDragController } from '../../hooks/useStripeDragController';
import { storage } from '../../utils/storage';
import EdgePanel from './EdgePanel';
import WorkspacePanelBody from './WorkspacePanelBody';

const PANEL_WIDTH = 138;

/**
 * Mobile workspace stripe — 8px-wide gradient stripe flush against the
 * handedness-aware screen edge. Tap or inward-swipe to open the workspace
 * panel. Hidden when fewer than 2 workspaces exist.
 */
export default function WorkspaceStripe() {
  const { instances, activeInstanceId } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);

  const handleCommit = useCallback(() => setOpen(true), []);
  const handleCancel = useCallback(() => {}, []);
  const { attachRef, dragOffset, isDragging } = useStripeDragController({
    panelWidth: PANEL_WIDTH,
    onCommit: handleCommit,
    onCancel: handleCancel,
  });

  useEffect(() => {
    if (instances.length < 2) return;
    if (storage.get('lotus.spine-onboarded')) return;
    setPulse(true);
    storage.set('lotus.spine-onboarded', '1');
    const t = window.setTimeout(() => setPulse(false), 420);
    return () => window.clearTimeout(t);
  }, [instances.length]);

  const active = instances.find((i) => i.id === activeInstanceId) ?? null;
  const color = useWorkspaceColor(active);

  if (instances.length < 2) return null;
  const style: CSSProperties = { ['--stripe-color' as never]: color };
  const showPanel = open || isDragging || dragOffset != null;

  return (
    <>
      <button
        ref={attachRef}
        type="button"
        className={`edge-stripe edge-stripe--workspace${pulse ? ' edge-stripe--pulse' : ''}`}
        style={style}
        onClick={() => setOpen(true)}
        aria-label="Switch workspace"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span
          className="edge-stripe-glyph material-symbols-outlined"
          aria-hidden="true"
        >
          workspaces
        </span>
        <span className="edge-stripe-bar" aria-hidden="true" />
      </button>
      {showPanel && (
        <EdgePanel
          open
          onClose={() => setOpen(false)}
          side="right"
          width={`${PANEL_WIDTH}px`}
          accentColor={color}
          ariaLabel="Workspaces"
          dragOffset={dragOffset}
          isDragging={isDragging}
        >
          <WorkspacePanelBody onDone={() => setOpen(false)} />
        </EdgePanel>
      )}
    </>
  );
}
