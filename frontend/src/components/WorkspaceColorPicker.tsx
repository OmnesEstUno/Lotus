import { useEffect, useRef, useState } from 'react';
import { HexColorPicker } from 'react-colorful';
import type { Instance } from '../types';
import { setInstanceColor } from '../api/instances';
import { setPendingColor } from '../utils/pendingColors';
import { colorForInstance } from '../utils/workspaceColor';
import { runMutation } from '../utils/mutation';

interface WorkspaceColorPickerProps {
  /** Workspace being edited. */
  instance: Instance;
  /** Where to render — provide the bounding rect of the trigger dot. */
  anchorRect: DOMRect;
  /** Called after persisting (success or error). The parent unmounts the picker. */
  onClose: () => void;
  /** Called when the persist hits a conflict so the parent can refresh. */
  onConflict?: (message: string) => void;
}

const PICKER_WIDTH = 200;
const PICKER_HEIGHT = 220;
const VIEWPORT_PADDING = 8;

export default function WorkspaceColorPicker({
  instance, anchorRect, onClose, onConflict,
}: WorkspaceColorPickerProps) {
  // Hex color — react-colorful's HexColorPicker returns "#rrggbb" strings.
  // Initialize from the resolved color (persisted or hash-derived).
  const initial = colorForInstance(instance);
  const [color, setColor] = useState<string>(() => normalizeHex(initial));
  const rootRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  // Push the live color to the pending bus on every change so all consumers
  // (spine, stripes, dots) update in real time.
  useEffect(() => {
    setPendingColor(instance.id, color);
    return () => {
      // On unmount, clear the pending so the persisted color (or hash) takes
      // over. The commit path also clears, but cleanup guards against escape
      // paths (e.g. parent unmounts before commit).
      setPendingColor(instance.id, null);
    };
  }, [instance.id, color]);

  // Persist on click outside.
  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current) return;
      if (rootRef.current.contains(e.target as Node)) return;
      if (closingRef.current) return;
      closingRef.current = true;
      void commit();
    }
    // Use `pointerdown` (instead of click) so the persist fires before any
    // other element's click handler runs — important on mobile.
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function commit() {
    await runMutation({
      onStart: () => {},
      call: () => setInstanceColor(instance.id, color, instance.version),
      onSuccess: () => {},
      onConflict: (msg) => onConflict?.(msg),
      onError: () => {},
      onFinally: () => {
        setPendingColor(instance.id, null);
        onClose();
      },
      conflictMessage: 'This workspace was modified by another session. Try again.',
    });
  }

  // Position the picker near the anchor rect — try below first, fall back to
  // above if there isn't room. Clamp horizontally to the viewport.
  const top = Math.min(
    anchorRect.bottom + 8,
    window.innerHeight - PICKER_HEIGHT - VIEWPORT_PADDING,
  );
  const left = Math.max(
    VIEWPORT_PADDING,
    Math.min(
      anchorRect.left + anchorRect.width / 2 - PICKER_WIDTH / 2,
      window.innerWidth - PICKER_WIDTH - VIEWPORT_PADDING,
    ),
  );

  return (
    <div
      ref={rootRef}
      className="workspace-color-picker"
      style={{ top, left, width: PICKER_WIDTH }}
      // Keep clicks inside from propagating to backdrop-style handlers.
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Change color for ${instance.name}`}
    >
      <HexColorPicker color={color} onChange={setColor} />
    </div>
  );
}

function normalizeHex(c: string): string {
  // colorForId returns "hsl(h, 60%, 55%)" — react-colorful's HexColorPicker
  // needs a hex string. Convert HSL → RGB → hex.
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
