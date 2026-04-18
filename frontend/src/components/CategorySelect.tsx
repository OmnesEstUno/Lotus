import { BUILT_IN_CATEGORIES, Category } from '../types';

// Sentinel value emitted by the onChange callback when the user picks
// "+ Create new category…". Callers should handle this by prompting for
// a name and adding it to the user's custom-categories list.
export const NEW_CATEGORY_SENTINEL = '__lotus_new_category__';

interface CategorySelectProps {
  value: Category;
  customCategories: string[];
  onChange: (picked: string) => void;
  compact?: boolean;
  disabled?: boolean;
}

/**
 * Reusable <select> for categories. Renders built-in + custom in two
 * optgroups plus a final "+ Create new category…" option. If the current
 * value isn't in either list (stale custom category, mapping orphan), it's
 * surfaced as an extra option so the select still displays correctly.
 */
export default function CategorySelect({
  value,
  customCategories,
  onChange,
  compact,
  disabled,
}: CategorySelectProps) {
  const valueInBuiltIn = (BUILT_IN_CATEGORIES as readonly string[]).includes(value);
  const valueInCustom = customCategories.includes(value);
  const orphaned = !valueInBuiltIn && !valueInCustom ? value : null;

  return (
    <select
      className="select"
      style={compact ? { padding: '4px 8px', fontSize: '0.8125rem' } : undefined}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <optgroup label="Built-in">
        {BUILT_IN_CATEGORIES.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </optgroup>
      {(customCategories.length > 0 || orphaned) && (
        <optgroup label="Custom">
          {customCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
          {orphaned && <option value={orphaned}>{orphaned}</option>}
        </optgroup>
      )}
      <option value={NEW_CATEGORY_SENTINEL}>+ Create new category…</option>
    </select>
  );
}
