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
          <div className="dashboard-card-header-left">
            <button
              ref={setActivatorNodeRef}
              {...attributes}
              {...listeners}
              type="button"
              aria-label="Drag to reorder card"
              className="dashboard-card-handle"
              style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            >
              <span className="material-symbols-outlined dashboard-card-drag-icon">
                drag_indicator
              </span>
            </button>
            <h2 className="dashboard-card-title">{title}</h2>
          </div>
          <div className="dashboard-card-actions">
            {headerActions}
            <button
              type="button"
              aria-label={minimized ? 'Expand card' : 'Minimize card'}
              aria-expanded={!minimized}
              onClick={onToggleMinimize}
              className="dashboard-card-minimize-btn"
            >
              <span className="material-symbols-outlined dashboard-card-minimize-icon">
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
