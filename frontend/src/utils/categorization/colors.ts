import { BuiltInCategory, Category } from '../../types';
import { ACCESSIBILITY_STORAGE_KEY } from '../accessibilityStorage';

// ─── Chart Colors ───────────────────────────────────────────────────────────

// Curated colors for built-in categories (default palette).
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

// Wong palette (Nature Methods, 2011) — deuteranopia/protanopia/tritanopia-safe.
// Index 7 (#000000) replaced with mid-gray to remain visible on dark backgrounds.
const WONG_PALETTE = [
  '#0072B2', // blue
  '#E69F00', // orange
  '#56B4E9', // sky
  '#009E73', // green
  '#F0E442', // yellow
  '#D55E00', // vermillion
  '#CC79A7', // purple
  '#888888', // gray (substituted for Wong's #000000 to remain visible on dark bg)
];

// Module-level palette flag, kept in sync by useAccessibilitySettings.
// Charts re-render naturally when their parent re-renders after the toggle.
let colorBlindMode = false;
let listeners: Array<() => void> = [];

// Initialize from localStorage at module load time so first chart paint
// uses the correct palette without waiting for React to mount.
try {
  const raw = localStorage.getItem(ACCESSIBILITY_STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw) as { colorBlindCharts?: boolean };
    if (parsed?.colorBlindCharts === true) colorBlindMode = true;
  }
} catch { /* defaults to false */ }

export function setColorBlindChartPalette(enabled: boolean): void {
  if (colorBlindMode === enabled) return;
  colorBlindMode = enabled;
  for (const cb of listeners) cb();
}

export function getColorBlindMode(): boolean {
  return colorBlindMode;
}

export function subscribeColorBlindMode(cb: () => void): () => void {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/**
 * Resolve a color for any category (built-in or custom). When color-blind
 * mode is on, all categories pull deterministically from the Wong palette.
 * Otherwise built-ins use their curated CATEGORY_COLORS color, customs hash
 * into CUSTOM_CATEGORY_PALETTE.
 */
export function getCategoryColor(category: Category): string {
  if (colorBlindMode) {
    return WONG_PALETTE[hashString(category) % WONG_PALETTE.length];
  }
  const builtIn = (CATEGORY_COLORS as Record<string, string | undefined>)[category];
  if (builtIn) return builtIn;
  return CUSTOM_CATEGORY_PALETTE[hashString(category) % CUSTOM_CATEGORY_PALETTE.length];
}
