import { ReactNode } from 'react';
import { Category } from '../../types';
import { getCategoryColor } from '../../utils/categorization/colors';
import CheckmarkToggle from '../CheckmarkToggle';

export interface Chip {
  key: Category;
  label: string;
  color?: string;
}

interface Props {
  chips: Chip[];
  /** Whether a given chip is currently active (checked). */
  isActive: (key: Category) => boolean;
  /** Per-chip click/toggle handler. */
  onToggle: (key: Category) => void;
  /** Select All button: receives the full list of chip keys. */
  onSelectAll: (allKeys: Category[]) => void;
  /** Deselect All button: caller decides semantics (empty set vs explicit-none). */
  onDeselectAll: () => void;
  /** Optional hover callbacks for the underlying CheckmarkToggle. */
  onHover?: (key: Category) => void;
  onLeave?: () => void;
  /** Per-chip opacity (e.g. for hover-dim effects). Defaults to 1. */
  opacityFor?: (key: Category) => number;
  /** Extra buttons to render on the action row after Select/Deselect All. */
  extraActions?: ReactNode;
  /** CheckmarkToggle size. */
  size?: 'sm' | 'md';
}

// Shared chip layout: row 1 = chips, row 2 = Select All / Deselect All / extras.
// Used by the Spending Trends legend and the month drill-down.
export default function CategoryChipRow({
  chips, isActive, onToggle, onSelectAll, onDeselectAll,
  onHover, onLeave, opacityFor, extraActions, size = 'sm',
}: Props) {
  const allKeys = chips.map((c) => c.key);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
      <div className="category-chip-row-chips">
        {chips.map((chip) => (
          <div
            key={chip.key}
            style={{
              opacity: opacityFor?.(chip.key) ?? 1,
              transition: 'opacity 0.15s',
            }}
          >
            <CheckmarkToggle
              label={chip.label}
              color={chip.color ?? getCategoryColor(chip.key)}
              active={isActive(chip.key)}
              size={size}
              onToggle={() => onToggle(chip.key)}
              onHover={onHover ? () => onHover(chip.key) : undefined}
              onLeave={onLeave}
            />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          onClick={() => onSelectAll(allKeys)}
        >
          Select All
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ padding: '4px 10px', fontSize: '0.75rem' }}
          onClick={onDeselectAll}
        >
          Deselect All
        </button>
        {extraActions}
      </div>
    </div>
  );
}
