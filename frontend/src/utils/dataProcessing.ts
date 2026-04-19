import { format, startOfWeek, startOfMonth, subDays, subMonths, parseISO, isWithinInterval } from 'date-fns';
import { Category, CustomDateRange, IncomeEntry, TimeRange, Transaction } from '../types';

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

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

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
    case 'custom':
      // Callers pass customRange and short-circuit this branch;
      // fall back to the past year so we never return an invalid range.
      return { start: subMonths(now, 12), end: now };
  }
}

// Pick a sensible bucket size based on the span. Short ranges bucket by day,
// medium ranges by week, long ranges by month.
function groupByPeriod(range: TimeRange, span?: number): (date: Date) => string {
  if (range === 'custom' && span !== undefined) {
    const days = span / (24 * 60 * 60 * 1000);
    if (days <= 14) return (d) => format(d, 'MMM d');
    if (days <= 180) return (d) => format(startOfWeek(d), 'MMM d');
    return (d) => format(startOfMonth(d), 'MMM yyyy');
  }
  switch (range) {
    case 'week':
      return (d) => format(d, 'MMM d');
    case 'month':
      return (d) => format(startOfWeek(d), 'MMM d');
    case '3month':
      return (d) => format(startOfWeek(d), 'MMM d');
    case 'year':
    case 'custom':
      return (d) => format(startOfMonth(d), 'MMM yyyy');
  }
}

// ─── Trending Line Chart Data ────────────────────────────────────────────────

// A point on the spending-trends line chart. The `label` key is the time
// bucket (e.g. "Apr 2026"); all other keys are category names mapping to the
// spending total in that bucket. Because `Category = string`, we can't use a
// `Record<Category, number>` type without conflicting with `label: string` —
// so we widen the value type to `string | number | undefined` and rely on
// runtime usage to treat category keys as numeric.
export type LineChartPoint = { label: string } & { [category: string]: string | number | undefined };

export function buildLineChartData(
  transactions: Transaction[],
  range: TimeRange,
  customRange?: CustomDateRange | null,
): LineChartPoint[] {
  const { start, end } = range === 'custom' && customRange
    ? { start: parseISO(customRange.start), end: parseISO(customRange.end) }
    : getDateRange(range);
  const getKey = groupByPeriod(range, end.getTime() - start.getTime());

  // Filter only expenses in the date range (exclude Taxes from trending, exclude archived)
  const filtered = transactions.filter((t) => {
    if (t.archived) return false;
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

// ─── Income vs Expenditures ──────────────────────────────────────────────────

export interface MonthlyBalance {
  month: string; // "Jan", "Feb", etc.
  monthIndex: number; // 0–11, useful for click handlers
  income: number;
  expenses: number; // includes taxes
  surplus: number; // signed — negative means deficit
}

export function buildMonthlyBalance(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
  year: number = new Date().getFullYear(),
): MonthlyBalance[] {
  const expenseByMonth = new Array(12).fill(0);
  const incomeByMonth = new Array(12).fill(0);

  transactions.forEach((t) => {
    if (t.archived) return;
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

  // Past years show all 12 months; current year truncates at the current month.
  const currentYear = new Date().getFullYear();
  const monthCount = year < currentYear ? 12 : new Date().getMonth() + 1;

  return MONTH_NAMES.slice(0, monthCount).map((month, i) => ({
    month,
    monthIndex: i,
    income: incomeByMonth[i],
    expenses: expenseByMonth[i],
    surplus: incomeByMonth[i] - expenseByMonth[i],
  }));
}

// ─── Per-Month Drill-Down ────────────────────────────────────────────────────

export interface DailyBalance {
  day: number;         // 1–31
  label: string;       // "1", "2", … "31"
  income: number;
  expenses: number;
}

export function buildDailyBalance(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
  year: number,
  month: number, // 0–11
): DailyBalance[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const result: DailyBalance[] = [];
  for (let day = 1; day <= daysInMonth; day++) {
    result.push({ day, label: String(day), income: 0, expenses: 0 });
  }

  transactions.forEach((t) => {
    if (t.archived) return;
    if (t.type !== 'expense') return;
    const d = parseISO(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    result[d.getDate() - 1].expenses += Math.abs(t.amount);
  });

  incomeEntries.forEach((entry) => {
    const d = parseISO(entry.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    result[d.getDate() - 1].income += entry.netAmount;
  });

  return result;
}

export interface MonthEvent {
  id: string;              // underlying Transaction.id or IncomeEntry.id
  date: string;            // ISO yyyy-mm-dd
  day: number;             // day of month
  kind: 'income' | 'expense';
  category?: Category;     // only for expenses
  description: string;
  amount: number;          // always positive for display
}

export function buildMonthEvents(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
  year: number,
  month: number, // 0–11
): MonthEvent[] {
  const events: MonthEvent[] = [];

  transactions.forEach((t) => {
    if (t.archived) return;
    if (t.type !== 'expense') return;
    const d = parseISO(t.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    events.push({
      id: t.id,
      date: t.date,
      day: d.getDate(),
      kind: 'expense',
      category: t.category,
      description: t.description,
      amount: Math.abs(t.amount),
    });
  });

  incomeEntries.forEach((entry) => {
    const d = parseISO(entry.date);
    if (d.getFullYear() !== year || d.getMonth() !== month) return;
    events.push({
      id: entry.id,
      date: entry.date,
      day: d.getDate(),
      kind: 'income',
      description: entry.description,
      amount: entry.netAmount,
    });
  });

  // Chronological: beginning of month at the top → end of month at the bottom
  events.sort((a, b) => a.date.localeCompare(b.date));
  return events;
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

// ─── Utilities ───────────────────────────────────────────────────────────────

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

