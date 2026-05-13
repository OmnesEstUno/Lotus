import { useEffect, useRef, useState } from 'react';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { colorForId } from '../../utils/workspaceColor';

export default function WorkspacePickerFAB() {
  const { instances, activeInstanceId, switchTo } = useWorkspaces();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (containerRef.current && !containerRef.current.contains(t)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!instances || instances.length === 0) return null;

  return (
    <div ref={containerRef} className="workspace-picker-fab-root">
      <div
        className={`workspace-picker-list${open ? ' workspace-picker-list--open' : ''}`}
        role="menu"
        aria-hidden={!open}
      >
        {instances.map((w, i) => {
          const isActive = w.id === activeInstanceId;
          return (
            <button
              key={w.id}
              type="button"
              role="menuitem"
              className={`workspace-picker-item${isActive ? ' workspace-picker-item--active' : ''}`}
              style={{ transitionDelay: open ? `${0.04 * i}s` : '0s' }}
              onClick={() => {
                void switchTo(w.id);
                setOpen(false);
              }}
            >
              <span
                className="workspace-picker-dot"
                style={{ background: colorForId(w.id) }}
              />
              <span className="workspace-picker-name">{w.name}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="fab-workspace-picker"
        aria-label="Switch workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="fab-workspace-picker-label">Workspaces</span>
        <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
          groups
        </span>
      </button>
    </div>
  );
}
