import { parseISO } from 'date-fns';
import { Category, CustomDateRange, Transaction } from '../../types';
import { LineChartPoint } from './lineChartData';

export function filterByRange(
  transactions: Transaction[],
  range: CustomDateRange | null,
): Transaction[] {
  if (!range) return transactions;
  return transactions.filter((t) => t.date >= range.start && t.date <= range.end);
}

/**
 * Return every distinct category that has at least one expense transaction,
 * excluding "Taxes" (which is intentionally hidden from the trending chart).
 * This yields both built-in and user-created custom categories dynamically.
 */
export function getTrendingCategories(transactions: Transaction[]): Category[] {
  const set = new Set<Category>();
  for (const t of transactions) {
    if (t.archived) continue;
    if (t.type !== 'expense') continue;
    if (t.category === 'Taxes') continue;
    set.add(t.category);
  }
  return [...set].sort();
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

// Span from the earliest to latest transaction date, as years + excess months.
// Archived transactions are excluded — they shouldn't extend the tracked range.
export function getTrackedDuration(transactions: Transaction[]): { years: number; months: number } {
  const active = transactions.filter((t) => !t.archived);
  if (active.length === 0) return { years: 0, months: 0 };
  const times = active.map((t) => parseISO(t.date).getTime());
  const minDate = new Date(Math.min(...times));
  const maxDate = new Date(Math.max(...times));
  const totalMonths = (maxDate.getFullYear() - minDate.getFullYear()) * 12
                    + (maxDate.getMonth() - minDate.getMonth());
  return { years: Math.floor(totalMonths / 12), months: totalMonths % 12 };
}

export function getMaxValue(data: LineChartPoint[], activeCategories: Set<Category>): number {
  let max = 0;
  for (const point of data) {
    for (const cat of activeCategories) {
      const val = (point[cat] as number | undefined) ?? 0;
      if (val > max) max = val;
    }
  }
  return max;
}
