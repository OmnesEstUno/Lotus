import { format, startOfWeek, startOfMonth, startOfYear, subDays, subMonths, parseISO, isWithinInterval } from 'date-fns';
import { Category, CATEGORIES, IncomeEntry, TimeRange, Transaction } from '../types';

// All expense categories except Taxes (excluded from trending graph per spec)
export const TRENDING_CATEGORIES = CATEGORIES.filter((c) => c !== 'Taxes');

// ─── Time Range Helpers ──────────────────────────────────────────────────────

function getDateRange(range: TimeRange): { start: Date; end: Date } {
  const now = new Date();
  switch (range) {
    case 'week':
      return { start: subDays(now, 7), end: now };
    case 'month':
      return { start: subDays(now, 30), end: now };
    case '3month':
      return { start: subMonths(now, 3), end: now };
    case 'year':
      return { start: subMonths(now, 12), end: now };
    case 'all':
      return { start: new Date(2000, 0, 1), end: now };
  }
}

function groupByPeriod(range: TimeRange): (date: Date) => string {
  switch (range) {
    case 'week':
      return (d) => format(d, 'MMM d');
    case 'month':
      return (d) => format(startOfWeek(d), 'MMM d');
    case '3month':
      return (d) => format(startOfWeek(d), 'MMM d');
    case 'year':
    case 'all':
      return (d) => format(startOfMonth(d), 'MMM yyyy');
  }
}

// ─── Trending Line Chart Data ────────────────────────────────────────────────

export type LineChartPoint = { label: string } & Partial<Record<Category, number>>;

export function buildLineChartData(transactions: Transaction[], range: TimeRange): LineChartPoint[] {
  const { start, end } = getDateRange(range);
  const getKey = groupByPeriod(range);

  // Filter only expenses in the date range (exclude Taxes from trending)
  const filtered = transactions.filter((t) => {
    if (t.type !== 'expense') return false;
    if (t.category === 'Taxes') return false;
    const d = parseISO(t.date);
    return isWithinInterval(d, { start, end });
  });

  // Collect all unique period labels in chronological order
  const labelSet = new Map<string, Date>();
  filtered.forEach((t) => {
    const d = parseISO(t.date);
    const key = getKey(d);
    if (!labelSet.has(key)) labelSet.set(key, d);
  });

  // Sort labels chronologically
  const labels = [...labelSet.entries()].sort((a, b) => a[1].getTime() - b[1].getTime()).map(([k]) => k);

  // Build a map: label → category → amount
  const data = new Map<string, Partial<Record<Category, number>>>();
  labels.forEach((l) => data.set(l, {}));

  filtered.forEach((t) => {
    const d = parseISO(t.date);
    const key = getKey(d);
    const entry = data.get(key)!;
    const val = Math.abs(t.amount);
    entry[t.category] = (entry[t.category] ?? 0) + val;
  });

  return labels.map((label) => ({
    label,
    ...(data.get(label) ?? {}),
  }));
}

// ─── Current-Year Expense Table ──────────────────────────────────────────────

export interface MonthlyExpenseRow {
  category: Category;
  months: number[]; // index 0 = Jan, 11 = Dec
  total: number;
}

export function buildMonthlyExpenseTable(transactions: Transaction[]): MonthlyExpenseRow[] {
  const year = new Date().getFullYear();
  const yearStart = startOfYear(new Date(year, 0, 1));
  const yearEnd = new Date(year, 11, 31, 23, 59, 59);

  const map = new Map<Category, number[]>();
  CATEGORIES.forEach((c) => map.set(c, new Array(12).fill(0)));

  transactions.forEach((t) => {
    if (t.type !== 'expense') return;
    const d = parseISO(t.date);
    if (!isWithinInterval(d, { start: yearStart, end: yearEnd })) return;
    const month = d.getMonth(); // 0-indexed
    const row = map.get(t.category)!;
    row[month] += Math.abs(t.amount);
  });

  return CATEGORIES.map((category) => {
    const months = map.get(category)!;
    const total = months.reduce((s, v) => s + v, 0);
    return { category, months, total };
  }).filter((row) => row.total > 0);
}

// ─── Income vs Expenditures ──────────────────────────────────────────────────

export interface MonthlyBalance {
  month: string; // "Jan", "Feb", etc.
  income: number;
  expenses: number; // includes taxes
  surplus: number;
}

export function buildMonthlyBalance(transactions: Transaction[], incomeEntries: IncomeEntry[]): MonthlyBalance[] {
  const year = new Date().getFullYear();

  const expenseByMonth = new Array(12).fill(0);
  const incomeByMonth = new Array(12).fill(0);

  transactions.forEach((t) => {
    if (t.type !== 'expense') return;
    const d = parseISO(t.date);
    if (d.getFullYear() !== year) return;
    expenseByMonth[d.getMonth()] += Math.abs(t.amount);
  });

  incomeEntries.forEach((entry) => {
    const d = parseISO(entry.date);
    if (d.getFullYear() !== year) return;
    incomeByMonth[d.getMonth()] += entry.netAmount;
    // Taxes are already tracked as separate transactions
  });

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const currentMonth = new Date().getMonth();

  return MONTH_NAMES.slice(0, currentMonth + 1).map((month, i) => ({
    month,
    income: incomeByMonth[i],
    expenses: expenseByMonth[i],
    surplus: incomeByMonth[i] - expenseByMonth[i],
  }));
}

// ─── Average Expenditures Per Category ──────────────────────────────────────

export interface CategoryAverage {
  category: Category;
  total: number;
  avgPerMonth: number;
  months: number;
}

export function buildCategoryAverages(transactions: Transaction[]): CategoryAverage[] {
  if (transactions.length === 0) return [];

  const expenses = transactions.filter((t) => t.type === 'expense');
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
  CATEGORIES.forEach((c) => totals.set(c, 0));

  expenses.forEach((t) => {
    totals.set(t.category, (totals.get(t.category) ?? 0) + Math.abs(t.amount));
  });

  return CATEGORIES.map((category) => {
    const total = totals.get(category) ?? 0;
    return {
      category,
      total,
      avgPerMonth: total / monthCount,
      months: monthCount,
    };
  }).filter((r) => r.total > 0);
}

// ─── Utilities ───────────────────────────────────────────────────────────────

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

export function getYearsSorted(transactions: Transaction[]): number[] {
  const years = new Set(transactions.map((t) => parseISO(t.date).getFullYear()));
  return [...years].sort((a, b) => b - a);
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

