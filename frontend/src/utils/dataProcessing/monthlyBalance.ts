import { parseISO } from 'date-fns';
import { IncomeEntry, Transaction } from '../../types';
import { MONTH_NAMES_SHORT } from '../dateConstants';

// ─── Period Accumulation Helper ──────────────────────────────────────────────

interface PeriodBucket { income: number; expenses: number; }

/**
 * Accumulate income and expenses from transactions and income entries into
 * period buckets keyed by an arbitrary string produced by `periodKey`.
 * Items that do not pass the respective filter predicate are skipped.
 */
function accumulateByPeriod(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
  periodKey: (date: Date) => string,
  filterTx: (t: Transaction, date: Date) => boolean,
  filterIncome: (e: IncomeEntry, date: Date) => boolean,
): Map<string, PeriodBucket> {
  const out = new Map<string, PeriodBucket>();

  for (const t of transactions) {
    const d = parseISO(t.date);
    if (!filterTx(t, d)) continue;
    const key = periodKey(d);
    const bucket = out.get(key) ?? { income: 0, expenses: 0 };
    bucket.expenses += Math.abs(t.amount);
    out.set(key, bucket);
  }

  for (const entry of incomeEntries) {
    const d = parseISO(entry.date);
    if (!filterIncome(entry, d)) continue;
    const key = periodKey(d);
    const bucket = out.get(key) ?? { income: 0, expenses: 0 };
    bucket.income += entry.netAmount;
    out.set(key, bucket);
  }

  return out;
}

// ─── Income vs Expenditures ──────────────────────────────────────────────────

export interface MonthlyBalance {
  month: string; // "Jan", "Feb", etc.
  monthIndex: number; // 0–11, useful for click handlers
  year: number; // the calendar year this row belongs to
  income: number;
  expenses: number; // includes taxes
  surplus: number; // signed — negative means deficit
}

export function buildMonthlyBalance(
  transactions: Transaction[],
  incomeEntries: IncomeEntry[],
  year: number = new Date().getFullYear(),
): MonthlyBalance[] {
  if (year === -1) {
    // All Time: one entry per (year, month) that has any activity.
    // Key = `${y}-${paddedMonth}` so string sort is chronological.
    const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;

    const map = accumulateByPeriod(
      transactions,
      incomeEntries,
      keyOf,
      (t, _d) => !t.archived && t.type === 'expense',
      // Taxes are already tracked as separate transactions; income added wholesale here.
      (_e, _d) => true,
    );

    return [...map.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([key, bucket]) => {
        const [y, m] = key.split('-').map(Number);
        return {
          month: `${MONTH_NAMES_SHORT[m]} ${y}`,
          monthIndex: m,
          year: y,
          income: bucket.income,
          expenses: bucket.expenses,
          surplus: bucket.income - bucket.expenses,
        };
      });
  }

  // Specific year: accumulate into 12 monthly buckets keyed by month index.
  const map = accumulateByPeriod(
    transactions,
    incomeEntries,
    (d) => String(d.getMonth()),
    (t, d) => !t.archived && t.type === 'expense' && d.getFullYear() === year,
    // Taxes are already tracked as separate transactions; income added wholesale here.
    (_e, d) => d.getFullYear() === year,
  );

  // Past years show all 12 months; current year truncates at the current month.
  const currentYear = new Date().getFullYear();
  const monthCount = year < currentYear ? 12 : new Date().getMonth() + 1;

  return MONTH_NAMES_SHORT.slice(0, monthCount).map((month, i) => {
    const bucket = map.get(String(i)) ?? { income: 0, expenses: 0 };
    return {
      month,
      monthIndex: i,
      year,
      income: bucket.income,
      expenses: bucket.expenses,
      surplus: bucket.income - bucket.expenses,
    };
  });
}
