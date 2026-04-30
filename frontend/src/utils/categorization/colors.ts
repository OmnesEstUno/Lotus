import { BuiltInCategory, Category } from '../../types';

// ─── Chart Colors ───────────────────────────────────────────────────────────

// Curated colors for built-in categories.
export const CATEGORY_COLORS: Record<BuiltInCategory, string> = {
  'Costco': '#F59E0B',
  'Amazon': '#F97316',
  'Groceries': '#84CC16',
  'Dining & Takeout': '#22D3EE',
  'Gas': '#A78BFA',
  'Shopping': '#818CF8',
  'Travel': '#38BDF8',
  'Entertainment': '#F472B6',
  'Pet Care': '#4ADE80',
  'Subscriptions & Utilities': '#67E8F9',
  'Automotive': '#D1D5DB',
  'Health & Wellness': '#86EFAC',
  'Personal Care': '#C084FC',
  'Home & Garden': '#A3E635',
  'Fees & Interest': '#FB7185',
  'Taxes': '#94A3B8',
  'Other': '#71717A',
};

// Palette used for user-created custom categories. Picked deterministically
// based on a hash of the category name so the same name always gets the same
// color across sessions.
const CUSTOM_CATEGORY_PALETTE = [
  '#fb923c', // orange 400
  '#facc15', // yellow 400
  '#14b8a6', // teal 500
  '#06b6d4', // cyan 500
  '#6366f1', // indigo 500
  '#c026d3', // fuchsia 600
  '#e11d48', // rose 600
  '#a855f7', // purple 500
  '#0ea5e9', // sky 500
  '#10b981', // emerald 500
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Resolve a color for any category (built-in or custom). Built-ins use their
 * curated color from CATEGORY_COLORS; custom categories get a deterministic
 * color from the custom palette based on the name hash.
 */
export function getCategoryColor(category: Category): string {
  const builtIn = (CATEGORY_COLORS as Record<string, string | undefined>)[category];
  if (builtIn) return builtIn;
  return CUSTOM_CATEGORY_PALETTE[hashString(category) % CUSTOM_CATEGORY_PALETTE.length];
}
