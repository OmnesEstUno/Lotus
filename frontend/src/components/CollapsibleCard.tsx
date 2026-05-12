import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

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

  // JS-driven height animation: CSS-only `grid-template-rows: 0fr → 1fr`
  // doesn't transition reliably across browsers (Firefox <134, Safari <16.5,
  // some Chromium builds), so we set explicit height in px and let the CSS
  // transition do the rest. After the open transition finishes we hand
  // height back to `auto` so the card flexes with content changes (e.g.
  // nested CollapsibleCards expanding inside).
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (firstRender.current) {
      firstRender.current = false;
      el.style.height = open ? 'auto' : '0px';
      return;
    }
    // Respect reduce-motion: if the computed transition is 0s, snap.
    const duration = parseFloat(getComputedStyle(el).transitionDuration) || 0;
    if (duration === 0) {
      el.style.height = open ? 'auto' : '0px';
      return;
    }
    if (open) {
      el.style.height = el.scrollHeight + 'px';
      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName !== 'height' || e.target !== el) return;
        el.style.height = 'auto';
        el.removeEventListener('transitionend', onEnd);
      };
      el.addEventListener('transitionend', onEnd);
      return () => el.removeEventListener('transitionend', onEnd);
    }
    // Closing: lock current height, force reflow, then transition to 0
    el.style.height = el.scrollHeight + 'px';
    void el.offsetHeight;
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.style.height = '0px';
    });
  }, [open]);

  const variantClass = `collapsible-card--${variant}`;
  const toneClass = tone !== 'default' ? `collapsible-card--tone-${tone}` : '';
  const className = ['card', 'collapsible-card', variantClass, toneClass].filter(Boolean).join(' ');

  // When collapsed, the entire card wrapper acts as a click target so users
  // don't have to aim for the header. The inner button still owns toggle for
  // keyboard users; we stopPropagation there so a click on the button doesn't
  // double-fire (button toggle → bubbles to outer → outer toggle → no-op).
  const handleOuterClick = !open ? toggle : undefined;

  return (
    <div className={className} style={cardStyle} onClick={handleOuterClick}>
      <div className="collapsible-card-header">
        <button
          type="button"
          className="collapsible-card-toggle"
          aria-expanded={open}
          onClick={(e) => { e.stopPropagation(); toggle(); }}
        >
          {variant === 'group' && iconName && (
            <span className="material-symbols-outlined collapsible-card-icon" aria-hidden="true">
              {iconName}
            </span>
          )}
          <h2 className="collapsible-card-title" style={titleStyle}>{title}</h2>
        </button>
        {headerExtra && <div className="collapsible-card-extra">{headerExtra}</div>}
        <span
          className="material-symbols-outlined collapsible-card-chevron"
          aria-hidden="true"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
        >
          expand_more
        </span>
      </div>
      <div ref={bodyRef} className="collapsible-card-body" data-open={open}>
        <div className="collapsible-card-body-inner">{children}</div>
      </div>
    </div>
  );
}
