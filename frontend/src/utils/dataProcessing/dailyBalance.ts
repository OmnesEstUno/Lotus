import { parseISO } from 'date-fns';
import { IncomeEntry, Transaction } from '../../types';

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
