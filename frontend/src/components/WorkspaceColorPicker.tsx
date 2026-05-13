import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { HexColorPicker } from 'react-colorful';
import type { Instance } from '../types';
import { setPendingColor } from '../utils/pendingColors';
import { colorForInstance } from '../utils/workspaceColor';

interface WorkspaceColorPickerProps {
  /** Workspace being edited. */
  instance: Instance;
  /** Bounding rect of the trigger dot in viewport coords. */
  anchorRect: DOMRect;
  /** Called when the user clicks outside the picker. Receives the final color
   *  the user picked. The parent is responsible for: unmounting the picker,
   *  persisting the color, refreshing, and clearing the pending color. */
  onCommit: (finalColor: string) => void;
  /** Called when the picker should close without committing (e.g. Escape).
   *  Parent unmounts and clears pending. */
  onCancel: () => void;
}

const PICKER_WIDTH = 220;
const PICKER_HEIGHT = 240;
const VIEWPORT_PADDING = 12;

export default function WorkspaceColorPicker({
  instance, anchorRect, onCommit, onCancel,
}: WorkspaceColorPickerProps) {
  const initial = colorForInstance(instance);
  const [color, setColor] = useState<string>(() => normalizeHex(initial));
  const rootRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  // Track whether onCommit/onCancel has fired so the unmount cleanup doesn't
  // double-clear or step on the parent's pending-color lifecycle.
  const terminatedRef = useRef(false);

  // Live-preview: push the draft to the pending bus on every change.
  useEffect(() => {
    setPendingColor(instance.id, color);
  }, [instance.id, color]);

  // Safety cleanup: if the picker unmounts WITHOUT going through onCommit
  // or onCancel (e.g. parent unmount, navigation), clear pending so we
  // don't leak. The normal paths set terminatedRef = true and rely on the
  // parent to clear after refresh.
  useEffect(() => {
    return () => {
      if (!terminatedRef.current) {
        setPendingColor(instance.id, null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Click-outside → commit. Use pointerdown (instead of click) so the
  // commit fires before any other element's click handler runs.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      if (closingRef.current) return;
      closingRef.current = true;
      terminatedRef.current = true;
      onCommit(color);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // `color` is in deps so the captured value is the latest draft on commit.
  }, [color, onCommit]);

  // Escape → cancel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (closingRef.current) return;
      closingRef.current = true;
      terminatedRef.current = true;
      onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  // Position the picker near the anchor, clamped to the viewport.
  const top = Math.max(
    VIEWPORT_PADDING,
    Math.min(
      anchorRect.bottom + 8,
      window.innerHeight - PICKER_HEIGHT - VIEWPORT_PADDING,
    ),
  );
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(
      anchorRect.left + anchorRect.width / 2 - PICKER_WIDTH / 2,
      window.innerWidth - PICKER_WIDTH - VIEWPORT_PADDING,
    ),
  );

  const picker = (
    <div
      ref={rootRef}
      className="workspace-color-picker"
      style={{ top, left, width: PICKER_WIDTH }}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Change color for ${instance.name}`}
    >
      <HexColorPicker color={color} onChange={setColor} />
    </div>
  );

  // Portal into document.body to escape any ancestor `overflow: hidden`
  // (notably the EdgePanel on mobile).
  return createPortal(picker, document.body);
}

function normalizeHex(c: string): string {
  if (c.startsWith('#') && /^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  const m = c.match(/^hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)$/);
  if (!m) return '#818cf8';
  return hslToHex(Number(m[1]), Number(m[2]), Number(m[3]));
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
