import { format, startOfWeek, startOfMonth, subDays, subMonths, parseISO, isWithinInterval } from 'date-fns';
import { Category, CustomDateRange, TimeRange, Transaction } from '../../types';

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
