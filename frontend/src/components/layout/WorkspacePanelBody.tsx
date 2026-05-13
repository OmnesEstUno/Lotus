import { useWorkspaces } from '../../hooks/useWorkspaces';
import { colorForId } from '../../utils/workspaceColor';
import { createInstance } from '../../api/instances';
import { dialog } from '../../utils/dialog';

interface WorkspacePanelBodyProps {
  /** Called after the user picks an existing workspace or finishes creating
   *  a new one. The parent uses this to close the surrounding EdgePanel. */
  onDone: () => void;
}

export default function WorkspacePanelBody({ onDone }: WorkspacePanelBodyProps) {
  const { instances, activeInstanceId, switchTo, refresh } = useWorkspaces();

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
          <button
            key={inst.id}
            type="button"
            className={
              `workspace-panel-pill${inst.id === activeInstanceId ? ' workspace-panel-pill--active' : ''}`
            }
            onClick={() => handlePick(inst.id)}
          >
            <span
              className="workspace-panel-dot"
              style={{ background: colorForId(inst.id) }}
              aria-hidden="true"
            />
            <span className="workspace-panel-name">{inst.name}</span>
          </button>
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
    </div>
  );
}
