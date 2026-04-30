import { useWorkspaces } from '../../hooks/useWorkspaces';
import { createInstance } from '../../api/instances';
import { dialog } from '../../utils/dialog';

export default function WorkspaceTabs() {
  const { instances, activeInstanceId, switchTo, refresh, loading } = useWorkspaces();

  if (loading) return <nav className="workspace-tabs" aria-label="Workspaces" />;
  if (instances.length === 0) return null;

  async function handleAddWorkspace() {
    const name = await dialog.prompt('New workspace name:');
    if (!name?.trim()) return;
    try {
      const created = await createInstance(name.trim());
      await refresh();
      await switchTo(created.id);
    } catch (err) {
      await dialog.alert((err as Error).message);
    }
  }

  return (
    <nav className="workspace-tabs" aria-label="Workspaces">
      {instances.map((inst) => (
        <button
          key={inst.id}
          type="button"
          className={`workspace-tab ${inst.id === activeInstanceId ? 'active' : ''}`}
          onClick={() => switchTo(inst.id)}
          title={inst.name}
        >
          <span className="workspace-tab-label">{inst.name}</span>
        </button>
      ))}
      <button
        type="button"
        className="workspace-tab-add"
        onClick={handleAddWorkspace}
        title="New workspace"
        aria-label="Create new workspace"
      >
        <span className="material-symbols-outlined">add_circle</span>
      </button>
    </nav>
  );
}
