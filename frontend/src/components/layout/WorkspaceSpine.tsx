import { useState } from 'react';
import type { CSSProperties } from 'react';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { colorForId } from '../../utils/workspaceColor';
import EdgePanel from './EdgePanel';
import WorkspacePanelBody from './WorkspacePanelBody';

/**
 * Desktop workspace spine — a sticky 4px-wide gradient stripe at the left
 * edge of the content area. Click anywhere in the 16px hit zone to open the
 * workspace panel. Hidden when fewer than 2 workspaces exist.
 */
export default function WorkspaceSpine() {
  const { instances, activeInstanceId } = useWorkspaces();
  const [open, setOpen] = useState(false);

  if (instances.length < 2) return null;

  const active = instances.find((i) => i.id === activeInstanceId);
  const color = active ? colorForId(active.id) : 'var(--accent)';
  const style: CSSProperties = { ['--spine-color' as never]: color };

  return (
    <>
      <button
        type="button"
        className="workspace-spine"
        style={style}
        onClick={() => setOpen(true)}
        aria-label="Switch workspace"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Workspaces"
      >
        <span className="workspace-spine-stripe" aria-hidden="true" />
      </button>
      <EdgePanel
        open={open}
        onClose={() => setOpen(false)}
        side="left"
        width="220px"
        accentColor={color}
        ariaLabel="Workspaces"
      >
        <WorkspacePanelBody onDone={() => setOpen(false)} />
      </EdgePanel>
    </>
  );
}
