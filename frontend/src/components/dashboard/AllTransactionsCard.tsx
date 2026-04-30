import { useMemo, useState } from 'react';
import { parseISO } from 'date-fns';
import { CustomDateRange, Transaction, UserCategories } from '../../types';
import type { TransactionUpdate } from '../../api/transactions';
import TransactionDrillDown, { DrillDownEvent } from './TransactionDrillDown';
import YearSelector, { ALL_YEARS, CUSTOM_RANGE } from './YearSelector';
import DateRangePicker from '../DateRangePicker';
import DashboardCard from './DashboardCard';

interface AllTransactionsCardProps {
  transactions: Transaction[];
  userCategories: UserCategories;
  addCustomCategory: (name: string) => string | null;
  onUpdateTransaction: (id: string, updates: TransactionUpdate) => Promise<void>;
  onDelete: (txnIds: string[], incIds: string[], label: string) => Promise<void>;
  isActiveOwner?: boolean;
  cardId: string;
  minimized: boolean;
  onToggleMinimize: () => void;
}

export default function AllTransactionsCard({
  transactions,
  userCategories,
  addCustomCategory,
  onUpdateTransaction,
  onDelete,
  isActiveOwner = true,
  cardId,
  minimized,
  onToggleMinimize,
}: AllTransactionsCardProps) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [range, setRange] = useState<CustomDateRange | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const events: DrillDownEvent[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((t) => !t.archived && t.type === 'expense')
      .filter((t) => {
        if (range) return t.date >= range.start && t.date <= range.end;
        if (year === ALL_YEARS) return true;
        return parseISO(t.date).getFullYear() === year;
      })
      .filter((t) => (q ? t.description.toLowerCase().includes(q) : true))
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((t) => ({
        id: t.id,
        kind: 'expense' as const,
        date: t.date,
        description: t.description,
        category: t.category,
        amount: Math.abs(t.amount),
        notes: t.notes,
      }));
  }, [transactions, year, range, searchQuery]);

  async function handleDeleteMany(txnIds: string[]): Promise<void> {
    const n = txnIds.length;
    await onDelete(txnIds, [], `Deleted ${n} transaction${n !== 1 ? 's' : ''}.`);
  }

  async function handleDeleteOne(event: DrillDownEvent): Promise<void> {
    await onDelete([event.id], [], `Deleted "${event.description}".`);
  }

  return (
    <DashboardCard
      id={cardId}
      title="All Transactions"
      minimized={minimized}
      onToggleMinimize={onToggleMinimize}
      headerActions={
        <YearSelector
          transactions={transactions}
          value={range ? CUSTOM_RANGE : year}
          onChange={(y) => {
            if (y === CUSTOM_RANGE) {
              const today = new Date();
              setRange({
                start: `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
                end: today.toISOString().slice(0, 10),
              });
            } else {
              setRange(null);
              setYear(y);
            }
          }}
          allowAllTime
          customOption
        />
      }
    >
      <input
        type="text"
        className="input"
        placeholder="Search descriptions…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ marginBottom: 12, maxWidth: 360 }}
      />
      {range && (() => {
        const today = new Date();
        const tenYearsAgo = new Date(today.getFullYear() - 10, today.getMonth(), today.getDate());
        const oldest = transactions.filter((t) => !t.archived).map((t) => t.date).sort()[0];
        const tenYrStr = tenYearsAgo.toISOString().slice(0, 10);
        const minDate = oldest && oldest > tenYrStr ? oldest : tenYrStr;
        return (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <DateRangePicker
              value={range}
              onChange={setRange}
              minDate={minDate}
              maxDate={today.toISOString().slice(0, 10)}
            />
          </div>
        );
      })()}
      <TransactionDrillDown
        events={events}
        onDeleteMany={(txnIds) => handleDeleteMany(txnIds)}
        onDeleteOne={handleDeleteOne}
        onUpdateTransaction={onUpdateTransaction}
        userCategories={userCategories}
        addCustomCategory={addCustomCategory}
        emptyMessage={
          searchQuery.trim()
            ? `No transactions matching "${searchQuery}"${year === ALL_YEARS ? '' : ` in ${year}`}.`
            : year === ALL_YEARS ? 'No transactions yet.' : `No transactions in ${year}.`
        }
        isActiveOwner={isActiveOwner}
      />
    </DashboardCard>
  );
}
