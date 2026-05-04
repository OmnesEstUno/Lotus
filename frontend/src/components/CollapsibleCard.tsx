import { useState, type CSSProperties, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Extra content rendered to the right of the title (badges, counts, etc.). */
  headerExtra?: ReactNode;
  /** Default open state. Defaults to false (collapsed). */
  defaultOpen?: boolean;
  /** Optional inline styles forwarded to the outer .card div. */
  cardStyle?: CSSProperties;
  /** Optional inline styles forwarded to the title h2. */
  titleStyle?: CSSProperties;
  children: ReactNode;
}

/**
 * Standard settings card with a clickable header that toggles body visibility.
 * Children stay mounted when collapsed (hidden via display: none) so any
 * internal component state survives expand/collapse.
 */
export default function CollapsibleCard({
  title,
  headerExtra,
  defaultOpen = false,
  cardStyle,
  titleStyle,
  children,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="card" style={cardStyle}>
      <div className="collapsible-card-header">
        <button
          type="button"
          className="collapsible-card-toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <h2 className="collapsible-card-title" style={titleStyle}>{title}</h2>
          <span
            className="material-symbols-outlined collapsible-card-chevron"
            aria-hidden="true"
          >
            {open ? 'expand_less' : 'expand_more'}
          </span>
        </button>
        {headerExtra && <div className="collapsible-card-extra">{headerExtra}</div>}
      </div>
      <div className="collapsible-card-body" hidden={!open}>
        {children}
      </div>
    </div>
  );
}
