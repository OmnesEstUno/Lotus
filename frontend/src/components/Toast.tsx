import { useEffect, useRef, useState } from 'react';
import { TOAST_DEFAULT_DURATION_MS, TOAST_TICK_INTERVAL_MS } from '../utils/constants';

interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
  /** Auto-dismiss after N milliseconds. Defaults to TOAST_DEFAULT_DURATION_MS. */
  duration?: number;
}

/**
 * Bottom-center toast notification. Used primarily for the "Undo delete"
 * flow — shows a message with an optional action button and auto-dismisses
 * after a timeout. Countdown bar visually indicates remaining time.
 */
export default function Toast({
  message,
  actionLabel,
  onAction,
  onDismiss,
  duration = TOAST_DEFAULT_DURATION_MS,
}: ToastProps) {
  const [remaining, setRemaining] = useState(100);

  // Keep a stable ref to onDismiss so the interval effect doesn't need it in
  // its dep array. Without this, a parent that creates a new onDismiss
  // reference each render would restart the interval on every render.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => { onDismissRef.current = onDismiss; }, [onDismiss]);

  // Track mount state to skip calling onDismiss after the component unmounts,
  // preventing "state update on unmounted component" React warnings.
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const pct = Math.max(0, 100 - (elapsed / duration) * 100);
      setRemaining(pct);
      if (pct <= 0) {
        window.clearInterval(interval);
        if (!mountedRef.current) return;
        onDismissRef.current();
      }
    }, TOAST_TICK_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [duration]); // onDismiss intentionally omitted — accessed via ref above

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        minWidth: 'min(320px, calc(100vw - 32px))',
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* Countdown bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          height: 3,
          width: `${remaining}%`,
          background: 'var(--accent)',
          transition: 'width 50ms linear',
        }}
      />

      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
        <polyline points="20 6 9 17 4 12" />
      </svg>

      <span style={{ flex: 1, color: 'var(--text-primary)', fontSize: '0.875rem' }}>{message}</span>

      {actionLabel && onAction && (
        <button
          className="btn btn-sm btn-secondary"
          style={{ padding: '5px 12px', fontSize: '0.8125rem' }}
          onClick={() => {
            onAction();
          }}
        >
          {actionLabel}
        </button>
      )}

      <button
        className="btn btn-ghost btn-sm"
        onClick={onDismiss}
        style={{ padding: '5px 8px', fontSize: '0.8125rem' }}
        title="Dismiss"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}
