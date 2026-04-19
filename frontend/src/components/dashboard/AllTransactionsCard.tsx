import { useMemo, useState } from 'react';
import { parseISO } from 'date-fns';
import { Transaction, UserCategories } from '../../types';
import { TransactionUpdate } from '../../api/client';
import TransactionDrillDown, { DrillDownEvent } from './TransactionDrillDown';
import YearSelector from './YearSelector';

interface AllTransactionsCardProps {
  transactions: Transaction[];
  userCategories: UserCategories;
  addCustomCategory: (name: string) => string | null;
  onUpdateTransaction: (id: string, updates: TransactionUpdate) => Promise<void>;
  onDelete: (txnIds: string[], incIds: string[], label: string) => Promise<void>;
  isActiveOwner?: boolean;
}

export default function AllTransactionsCard({
  transactions,
  userCategories,
  addCustomCategory,
  onUpdateTransaction,
  onDelete,
  isActiveOwner = true,
}: AllTransactionsCardProps) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [searchQuery, setSearchQuery] = useState('');

  const events: DrillDownEvent[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return transactions
      .filter((t) => !t.archived && t.type === 'expense')
      .filter((t) => parseISO(t.date).getFullYear() === year)
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
  }, [transactions, year, searchQuery]);

  async function handleDeleteMany(txnIds: string[]): Promise<void> {
    const n = txnIds.length;
    await onDelete(txnIds, [], `Deleted ${n} transaction${n !== 1 ? 's' : ''}.`);
  }

  async function handleDeleteOne(event: DrillDownEvent): Promise<void> {
    await onDelete([event.id], [], `Deleted "${event.description}".`);
  }

  return (
    <div className="card">
      <div className="card-header">
        <h2>All Transactions</h2>
        <YearSelector transactions={transactions} value={year} onChange={setYear} />
      </div>
      <input
        type="text"
        className="input"
        placeholder="Search descriptions…"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        style={{ marginBottom: 12, maxWidth: 360 }}
      />
      <TransactionDrillDown
        events={events}
        onDeleteMany={(txnIds) => handleDeleteMany(txnIds)}
        onDeleteOne={handleDeleteOne}
        onUpdateTransaction={onUpdateTransaction}
        userCategories={userCategories}
        addCustomCategory={addCustomCategory}
        emptyMessage={searchQuery.trim() ? `No transactions matching "${searchQuery}" in ${year}.` : `No transactions in ${year}.`}
        isActiveOwner={isActiveOwner}
      />
    </div>
  );
}
