import { useRef, useState } from 'react';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useWorkspaceColor } from '../../hooks/useWorkspaceColor';
import { createInstance } from '../../api/instances';
import { dialog } from '../../utils/dialog';
import type { Instance } from '../../types';
import WorkspaceColorPicker from '../WorkspaceColorPicker';

interface WorkspacePanelBodyProps {
  onDone: () => void;
}

interface PickerState {
  instance: Instance;
  rect: DOMRect;
}

export default function WorkspacePanelBody({ onDone }: WorkspacePanelBodyProps) {
  const { instances, activeInstanceId, switchTo, refresh } = useWorkspaces();
  const currentUser = useCurrentUser();
  const [picker, setPicker] = useState<PickerState | null>(null);

  async function handleNew() {
    const name = await dialog.prompt('New workspace name:');
    if (!name?.trim()) return;
    try {
      const created = await createInstance(name.trim());
      await refresh();
      await switchTo(created.id);
      onDone();
    } catch (err) {
      await dialog.alert((err as Error).message);
    }
  }

  async function handlePick(id: string) {
    await switchTo(id);
    onDone();
  }

  return (
    <div className="workspace-panel-body">
      <h2 className="workspace-panel-title">Workspaces</h2>
      <div className="workspace-panel-list">
        {instances.map((inst) => (
          <WorkspacePanelPill
            key={inst.id}
            instance={inst}
            active={inst.id === activeInstanceId}
            isOwner={inst.owner === currentUser}
            onPick={handlePick}
            onEditColor={(rect) => setPicker({ instance: inst, rect })}
          />
        ))}
      </div>
      <button
        type="button"
        className="workspace-panel-new"
        onClick={handleNew}
      >
        <span aria-hidden="true">＋</span>
        <span>New workspace</span>
      </button>
      {picker && (
        <WorkspaceColorPicker
          instance={picker.instance}
          anchorRect={picker.rect}
          onClose={() => { setPicker(null); void refresh(); }}
          onConflict={() => { setPicker(null); void refresh(); }}
        />
      )}
    </div>
  );
}

interface PillProps {
  instance: Instance;
  active: boolean;
  isOwner: boolean;
  onPick: (id: string) => void;
  onEditColor: (rect: DOMRect) => void;
}

function WorkspacePanelPill({ instance, active, isOwner, onPick, onEditColor }: PillProps) {
  const color = useWorkspaceColor(instance);
  const dotRef = useRef<HTMLButtonElement | HTMLSpanElement | null>(null);

  function handleDotClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!isOwner) return;
    const target = e.currentTarget as HTMLElement;
    onEditColor(target.getBoundingClientRect());
  }

  return (
    <div className={`workspace-panel-pill${active ? ' workspace-panel-pill--active' : ''}`}>
      {isOwner ? (
        <button
          ref={dotRef as React.RefObject<HTMLButtonElement>}
          type="button"
          className="workspace-panel-dot workspace-panel-dot--editable"
          style={{ background: color }}
          onClick={handleDotClick}
          aria-label={`Change color for ${instance.name}`}
        />
      ) : (
        <span
          ref={dotRef as React.RefObject<HTMLSpanElement>}
          className="workspace-panel-dot"
          style={{ background: color }}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        className="workspace-panel-name-btn"
        onClick={() => onPick(instance.id)}
      >
        {instance.name}
      </button>
    </div>
  );
}
