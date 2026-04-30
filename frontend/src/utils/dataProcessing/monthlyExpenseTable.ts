import { parseISO } from 'date-fns';
import { Category, CustomDateRange, Transaction } from '../../types';

// ─── Current-Year Expense Table ──────────────────────────────────────────────

export interface MonthlyExpenseRow {
  category: Category;
  months: number[]; // index 0 = Jan, 11 = Dec
  total: number;
}

export interface MonthColumn {
  year: number;
  month: number; // 0-indexed
}

export interface MonthlyTableResult {
  columns: MonthColumn[];
  rows: Array<{ category: Category; months: number[]; total: number }>;
}

export function buildMonthlyExpenseTable(
  transactions: Transaction[],
  yearOrRange: number | CustomDateRange,
): MonthlyTableResult {
  let columns: MonthColumn[];
  let filtered: Transaction[];

  if (typeof yearOrRange === 'number') {
    const year = yearOrRange;
    const now = new Date();
    const lastMonth = year < now.getFullYear() ? 11 : now.getMonth();
    columns = [];
    for (let m = 0; m <= lastMonth; m++) columns.push({ year, month: m });
    filtered = transactions.filter((t) => {
      if (t.archived || t.type !== 'expense') return false;
      return parseISO(t.date).getFullYear() === year;
    });
  } else {
    const { start, end } = yearOrRange;
    const startDate = parseISO(start);
    const endDate = parseISO(end);
    columns = [];
    const cur = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const stop = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while (cur <= stop) {
      columns.push({ year: cur.getFullYear(), month: cur.getMonth() });
      cur.setMonth(cur.getMonth() + 1);
    }
    filtered = transactions.filter((t) => {
      if (t.archived || t.type !== 'expense') return false;
      return t.date >= start && t.date <= end;
    });
  }

  const colIndex = new Map<string, number>();
  columns.forEach((c, i) => colIndex.set(`${c.year}-${c.month}`, i));
  const byCategory = new Map<Category, number[]>();
  for (const t of filtered) {
    const d = parseISO(t.date);
    const idx = colIndex.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (idx === undefined) continue;
    const bucket = byCategory.get(t.category) ?? new Array(columns.length).fill(0);
    bucket[idx] += Math.abs(t.amount);
    byCategory.set(t.category, bucket);
  }

  const rows = Array.from(byCategory.entries())
    .map(([category, months]) => ({
      category,
      months,
      total: months.reduce((s, v) => s + v, 0),
    }))
    .sort((a, b) => b.total - a.total);

  return { columns, rows };
}
