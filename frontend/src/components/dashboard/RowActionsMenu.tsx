import { ReactNode, useEffect, useRef, useState } from 'react';

interface Action {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  actions: Action[];
  disabled?: boolean;
}

const MENU_WIDTH = 160;
const MENU_ITEM_HEIGHT = 36;

// Ellipsis trigger with a floating vertical menu. Menu is position:fixed
// relative to the trigger's bounding rect, so it never shifts sibling
// layout and never gets clipped by overflow:hidden parents (like the
// drill-down's preview-scroll container).
export default function RowActionsMenu({ actions, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        menuRef.current && !menuRef.current.contains(t) &&
        triggerRef.current && !triggerRef.current.contains(t)
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openMenu() {
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const menuHeight = MENU_ITEM_HEIGHT * actions.length + 8;
    const spaceBelow = window.innerHeight - r.bottom;
    const top = spaceBelow < menuHeight + 12
      ? Math.max(8, r.top - menuHeight - 4)
      : r.bottom + 4;
    // Right-align the menu to the trigger button.
    const rawLeft = r.right - MENU_WIDTH;
    const left = Math.min(
      window.innerWidth - MENU_WIDTH - 8,
      Math.max(8, rawLeft),
    );
    setCoords({ top, left });
    setOpen(true);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => (open ? setOpen(false) : openMenu())}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        style={{ padding: '4px 8px' }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
          more_vert
        </span>
      </button>
      {open && coords && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: MENU_WIDTH,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 6px 20px rgba(0, 0, 0, 0.4)',
            padding: 4,
            zIndex: 200,
          }}
        >
          {actions.map((a, i) => (
            <button
              key={i}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false);
                a.onClick();
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 12px',
                background: 'transparent',
                border: 'none',
                color: a.danger ? 'var(--danger)' : 'var(--text-primary)',
                cursor: 'pointer',
                borderRadius: 6,
                fontSize: '0.875rem',
                textAlign: 'left',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-surface)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
              }}
            >
              <span style={{ display: 'inline-flex', width: 16, height: 16, alignItems: 'center', justifyContent: 'center' }}>
                {a.icon}
              </span>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
