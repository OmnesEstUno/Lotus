import { useWorkspaces } from '../../hooks/useWorkspaces';

export default function WorkspaceTabs() {
  const { instances, activeInstanceId, switchTo, loading } = useWorkspaces();

  if (loading) return <nav className="workspace-tabs" aria-label="Workspaces" />;
  if (instances.length === 0) return null;

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
    </nav>
  );
}
