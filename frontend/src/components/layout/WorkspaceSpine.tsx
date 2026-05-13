import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useWorkspaceColor } from '../../hooks/useWorkspaceColor';
import { storage } from '../../utils/storage';
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
  const [pulse, setPulse] = useState(false);
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
  const style: CSSProperties = { ['--spine-color' as never]: color };

  return (
    <>
      <button
        type="button"
        className={`workspace-spine${pulse ? ' workspace-spine--pulse' : ''}`}
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
