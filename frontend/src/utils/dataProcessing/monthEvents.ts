import { parseISO } from 'date-fns';
import { Category, IncomeEntry, Transaction } from '../../types';

// ─── Per-Month Drill-Down ────────────────────────────────────────────────────

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
