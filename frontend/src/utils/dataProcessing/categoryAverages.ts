import { parseISO } from 'date-fns';
import { Category, Transaction } from '../../types';

// ─── Average Expenditures Per Category ──────────────────────────────────────

export interface CategoryAverage {
  category: Category;
  total: number;
  avgPerMonth: number;
  months: number;
}

export function buildCategoryAverages(transactions: Transaction[]): CategoryAverage[] {
  if (transactions.length === 0) return [];

  const expenses = transactions.filter((t) => !t.archived && t.type === 'expense');
  if (expenses.length === 0) return [];

  // Find overall date range
  const dates = expenses.map((t) => parseISO(t.date));
  const minDate = new Date(Math.min(...dates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map((d) => d.getTime())));

  // Count unique months in range
  const monthCount = Math.max(
    1,
    (maxDate.getFullYear() - minDate.getFullYear()) * 12 + maxDate.getMonth() - minDate.getMonth() + 1,
  );

  const totals = new Map<Category, number>();

  expenses.forEach((t) => {
    totals.set(t.category, (totals.get(t.category) ?? 0) + Math.abs(t.amount));
  });

  return [...totals.entries()]
    .map(([category, total]) => ({
      category,
      total,
      avgPerMonth: total / monthCount,
      months: monthCount,
    }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.avgPerMonth - a.avgPerMonth);
}
