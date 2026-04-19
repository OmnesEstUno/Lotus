import { parseISO } from 'date-fns';
import { IncomeEntry, Transaction } from '../../types';

// Sentinel value meaning "aggregate across every year of data" — not a real year.
export const ALL_YEARS = 0;

interface YearSelectorProps {
  transactions: Transaction[];
  incomeEntries?: IncomeEntry[];
  value: number;
  onChange: (year: number) => void;
  allowAllTime?: boolean;
}

// Renders a <select> of years derived from the data, descending. Pulls
// from transactions (skipping archived) plus income entries if provided.
// Always includes the current year even if there's no data for it.
// When allowAllTime is set, an "All Time" option (value ALL_YEARS) is
// appended to the bottom of the list.
export default function YearSelector({ transactions, incomeEntries, value, onChange, allowAllTime }: YearSelectorProps) {
  const currentYear = new Date().getFullYear();
  const fromData = new Set<number>();
  for (const t of transactions) {
    if (t.archived) continue;
    fromData.add(parseISO(t.date).getFullYear());
  }
  if (incomeEntries) {
    for (const e of incomeEntries) {
      fromData.add(parseISO(e.date).getFullYear());
    }
  }
  fromData.add(currentYear);
  const years = [...fromData].sort((a, b) => b - a);
  return (
    <select
      className="select"
      style={{ width: 'auto', padding: '5px 10px', fontSize: '0.8125rem' }}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {years.map((y) => (
        <option key={y} value={y}>{y}</option>
      ))}
      {allowAllTime && <option value={ALL_YEARS}>All Time</option>}
    </select>
  );
}
