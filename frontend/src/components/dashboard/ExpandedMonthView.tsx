import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Transaction, IncomeEntry, Category, UserCategories } from '../../types';
import { updateTransaction, updateIncome } from '../../api/client';
import {
  buildDailyBalance, buildMonthEvents, formatCurrency, MONTH_NAMES,
} from '../../utils/dataProcessing';
import { getCategoryColor } from '../../utils/categories';
import { INCOME_COLOR, EXPENSE_COLOR } from './constants';
import TransactionDrillDown, { DrillDownEvent } from './TransactionDrillDown';

// ─── Monthly balance: expanded (per-month) view ────────────────────────────

interface ExpandedMonthViewProps {
  transactions: Transaction[];
  incomeEntries: IncomeEntry[];
  year: number;
  month: number; // 0–11
  onDelete: (txnIds: string[], incIds: string[], label: string) => Promise<void>;
  onUpdateTransaction: (id: string, updates: Parameters<typeof updateTransaction>[1]) => Promise<void>;
  onUpdateIncome: (id: string, updates: Parameters<typeof updateIncome>[1]) => Promise<void>;
  userCategories: UserCategories;
  addCustomCategory: (name: string) => string | null;
  isActiveOwner?: boolean;
}

function ExpandedMonthView({
  transactions,
  incomeEntries,
  year,
  month,
  onDelete,
  onUpdateTransaction,
  onUpdateIncome,
  userCategories,
  addCustomCategory,
  isActiveOwner = true,
}: ExpandedMonthViewProps) {
  const dailyBalance = buildDailyBalance(transactions, incomeEntries, year, month);
  const rawEvents = buildMonthEvents(transactions, incomeEntries, year, month);

  const [searchQuery, setSearchQuery] = useState('');

  // Clear search when the expanded month changes
  useEffect(() => {
    setSearchQuery('');
  }, [year, month]);

  // Search filter layered on top of the chronological event list
  const filteredRawEvents = searchQuery.trim()
    ? rawEvents.filter((e) => e.description.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : rawEvents;

  // Transform MonthEvent[] into the unified DrillDownEvent[] shape.
  // For income events, look up the original transaction notes if applicable
  // (income entries don't have notes, so notes is always undefined for income).
  const drillDownEvents: DrillDownEvent[] = filteredRawEvents.map((e) => ({
    id: e.id,
    kind: e.kind,
    date: e.date,
    description: e.description,
    category: e.category,
    amount: e.amount,
    notes: e.kind === 'expense'
      ? transactions.find((t) => t.id === e.id)?.notes
      : undefined,
  }));

  // Per-category totals for quick reference above the chronological list
  const categoryTotals = new Map<Category, number>();
  let incomeTotal = 0;
  rawEvents.forEach((e) => {
    if (e.kind === 'income') {
      incomeTotal += e.amount;
    } else if (e.category) {
      categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + e.amount);
    }
  });

  const monthLabel = `${MONTH_NAMES[month]} ${year}`;

  return (
    <>
      {/* Daily trend bar chart — no surplus/deficit bars in expanded mode */}
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={dailyBalance} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
            label={{ value: `Day of ${MONTH_NAMES[month]}`, position: 'insideBottom', offset: -4, fill: 'var(--text-muted)', fontSize: 11 }}
          />
          <YAxis
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
          />
          <Tooltip
            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8125rem' }}
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            labelFormatter={(label: string) => `${MONTH_NAMES[month]} ${label}`}
            formatter={(value: number, name: string) => [formatCurrency(value), name]}
          />
          <Legend wrapperStyle={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }} />
          <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Category summary for the month */}
      {categoryTotals.size > 0 && (
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <h3 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
            {monthLabel} summary
          </h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {incomeTotal > 0 && (
              <span
                className="chip"
                style={{
                  background: 'var(--success-bg)',
                  color: 'var(--success)',
                  border: '1px solid rgba(74,222,128,0.25)',
                  padding: '4px 10px',
                }}
              >
                Income: {formatCurrency(incomeTotal)}
              </span>
            )}
            {[...categoryTotals.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([cat, total]) => (
                <span
                  key={cat}
                  className="chip"
                  style={{
                    background: `${getCategoryColor(cat)}18`,
                    color: getCategoryColor(cat),
                    border: `1px solid ${getCategoryColor(cat)}40`,
                    padding: '4px 10px',
                  }}
                >
                  {cat}: {formatCurrency(total)}
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Chronological events list */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ color: 'var(--text-secondary)' }}>
            Activity — oldest to newest
            <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
              ({filteredRawEvents.length} of {rawEvents.length} entr{rawEvents.length !== 1 ? 'ies' : 'y'})
            </span>
          </h3>
        </div>

        <input
          type="text"
          className="input"
          placeholder="Search descriptions…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ marginBottom: 12, maxWidth: 360 }}
        />

        {rawEvents.length === 0 ? (
          <p className="text-muted text-sm">No activity recorded for {monthLabel}.</p>
        ) : (
          <TransactionDrillDown
            events={drillDownEvents}
            onDeleteMany={(txnIds, incIds) =>
              onDelete(txnIds, incIds, `Deleted ${txnIds.length + incIds.length} entr${txnIds.length + incIds.length !== 1 ? 'ies' : 'y'} from ${monthLabel}.`)
            }
            onDeleteOne={(event) => {
              if (event.kind === 'income') {
                return onDelete([], [event.id], `Deleted income entry "${event.description}".`);
              }
              return onDelete([event.id], [], `Deleted "${event.description}".`);
            }}
            onUpdateTransaction={onUpdateTransaction}
            onUpdateIncome={onUpdateIncome}
            userCategories={userCategories}
            addCustomCategory={addCustomCategory}
            emptyMessage={searchQuery.trim() ? `No entries matching "${searchQuery}".` : `No activity recorded for ${monthLabel}.`}
            isActiveOwner={isActiveOwner}
          />
        )}
      </div>
    </>
  );
}

export default ExpandedMonthView;
