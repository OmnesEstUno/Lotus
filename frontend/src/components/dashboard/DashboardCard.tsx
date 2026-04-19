import { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface DashboardCardProps {
  id: string;
  title: ReactNode;
  headerActions?: ReactNode;
  minimized: boolean;
  onToggleMinimize: () => void;
  children: ReactNode;
}

// Sortable dashboard card with a minimize toggle and a drag handle.
// Drag is activated only from the grip icon (setActivatorNodeRef). The body
// collapses when minimized, leaving only the header row visible.
export default function DashboardCard({
  id,
  title,
  headerActions,
  minimized,
  onToggleMinimize,
  children,
}: DashboardCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 2 : 'auto',
    position: 'relative',
  };

  return (
    <div ref={setNodeRef} style={style} className="section">
      <div className="card">
        <div
          className="card-header"
          style={{
            marginBottom: minimized ? 0 : undefined,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              type="button"
              aria-label="Drag to reorder card"
              className="dashboard-card-handle"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                minWidth: 32,
                padding: 0,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: isDragging ? 'grabbing' : 'grab',
                borderRadius: 6,
                touchAction: 'none',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
                drag_indicator
              </span>
            </button>
            <h2 style={{ margin: 0, minWidth: 0 }}>{title}</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {headerActions}
            <button
              type="button"
              aria-label={minimized ? 'Expand card' : 'Minimize card'}
              aria-expanded={!minimized}
              onClick={onToggleMinimize}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 44,
                height: 44,
                padding: 0,
                background: 'transparent',
                border: 'none',
                color: 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: 6,
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 22 }}>
                {minimized ? 'expand_more' : 'expand_less'}
              </span>
            </button>
          </div>
        </div>
        {!minimized && children}
      </div>
    </div>
  );
}
