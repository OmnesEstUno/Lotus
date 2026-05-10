import { useState, type CSSProperties, type ReactNode } from 'react';

interface Props {
  title: string;
  /** Extra content rendered to the right of the title (badges, counts, etc.). */
  headerExtra?: ReactNode;
  /** Default open state. Defaults to false (collapsed). Ignored if `open` is provided. */
  defaultOpen?: boolean;
  /** Controlled open state. When set, the parent owns visibility. */
  open?: boolean;
  /** Called when the user toggles the card. */
  onOpenChange?: (open: boolean) => void;
  /** Optional inline styles forwarded to the outer .card div. */
  cardStyle?: CSSProperties;
  /** Optional inline styles forwarded to the title h2. */
  titleStyle?: CSSProperties;
  children: ReactNode;
  /**
   * Visual variant. 'card' (default) is the existing inner-card look used
   * inside groups and elsewhere. 'group' is the new outer-shell treatment
   * used for the four top-level Settings groupings.
   */
  variant?: 'card' | 'group';
  /**
   * Material Symbols Outlined icon name to render in the header.
   * Required for variant='group'; ignored for 'card'.
   */
  iconName?: string;
  /**
   * Tone modifier. 'danger' tints the icon chip + outer border for the
   * Danger Zone group.
   */
  tone?: 'default' | 'danger';
}

/**
 * Standard settings card with a clickable header that toggles body visibility.
 * Children stay mounted when collapsed (the body grid-row collapses to 0fr)
 * so any internal component state survives expand/collapse.
 */
export default function CollapsibleCard({
  title,
  headerExtra,
  defaultOpen = false,
  open: controlledOpen,
  onOpenChange,
  cardStyle,
  titleStyle,
  children,
  variant = 'card',
  iconName,
  tone = 'default',
}: Props) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const toggle = () => {
    const next = !open;
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
  };

  const variantClass = `collapsible-card--${variant}`;
  const toneClass = tone !== 'default' ? `collapsible-card--tone-${tone}` : '';
  const className = ['card', 'collapsible-card', variantClass, toneClass].filter(Boolean).join(' ');

  return (
    <div className={className} style={cardStyle}>
      <div className="collapsible-card-header">
        <button
          type="button"
          className="collapsible-card-toggle"
          aria-expanded={open}
          onClick={toggle}
        >
          {variant === 'group' && iconName && (
            <span className="material-symbols-outlined collapsible-card-icon" aria-hidden="true">
              {iconName}
            </span>
          )}
          <h2 className="collapsible-card-title" style={titleStyle}>{title}</h2>
          <span
            className="material-symbols-outlined collapsible-card-chevron"
            aria-hidden="true"
          >
            expand_more
          </span>
        </button>
        {headerExtra && <div className="collapsible-card-extra">{headerExtra}</div>}
      </div>
      <div className="collapsible-card-body" data-open={open}>
        <div className="collapsible-card-body-inner">{children}</div>
      </div>
    </div>
  );
}
