import { useState, useEffect } from 'react';
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Transaction, IncomeEntry, Category, UserCategories } from '../../types';
import { updateTransaction, updateIncome } from '../../api/client';
import {
  buildDailyBalance, buildMonthEvents, formatCurrency, MONTH_NAMES,
} from '../../utils/dataProcessing';
import { INCOME_COLOR, EXPENSE_COLOR, formatAxisCurrency } from './constants';
import TransactionDrillDown, { DrillDownEvent } from './TransactionDrillDown';
import MonthTotalsBar from './MonthTotalsBar';
import CategoryChipRow from './CategoryChipRow';

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

  // ── Task 14: day-click filter ──────────────────────────────────────────────
  const [selectedDays, setSelectedDays] = useState<Set<number>>(new Set());

  // ── Task 15: category multi-select ────────────────────────────────────────
  // null = untouched (inert filter, show all). Any user action moves to a Set —
  // including an empty set, which means "hide all expenses".
  const [selectedCategories, setSelectedCategories] = useState<Set<Category> | null>(null);

  const [searchQuery, setSearchQuery] = useState('');

  // Clear all filters when the expanded month changes
  useEffect(() => {
    setSearchQuery('');
    setSelectedDays(new Set());
    setSelectedCategories(null);
  }, [year, month]);

  // Per-category totals for quick reference above the chronological list
  const categoryTotals = new Map<Category, number>();
  let totalIncome = 0;
  let totalExpenses = 0;
  rawEvents.forEach((e) => {
    if (e.kind === 'income') {
      totalIncome += e.amount;
    } else {
      totalExpenses += e.amount;
      if (e.category) {
        categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + e.amount);
      }
    }
  });

  const monthLabel = `${MONTH_NAMES[month]} ${year}`;

  // ── Composed filter chain ──────────────────────────────────────────────────
  // Step 1: day filter
  const afterDayFilter = selectedDays.size === 0
    ? rawEvents
    : rawEvents.filter((e) => selectedDays.has(e.day));

  // Step 2: category filter.
  // null = untouched, inert (income + all expenses pass through).
  // Set = explicit user choice; income always passes, expenses must be in the set.
  const afterCategoryFilter = selectedCategories === null
    ? afterDayFilter
    : afterDayFilter.filter((e) => {
        if (e.kind !== 'expense') return true; // income always passes
        if (!e.category) return false;
        return selectedCategories.has(e.category);
      });

  // Step 3: search filter
  const filteredRawEvents = searchQuery.trim()
    ? afterCategoryFilter.filter((e) =>
        e.description.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : afterCategoryFilter;

  // Transform MonthEvent[] into the unified DrillDownEvent[] shape.
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

  return (
    <>
      {/* ── Task 13: two-column chart layout ─────────────────────────────── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '2 1 400px' }}>
          {/* Daily trend bar chart — no surplus/deficit bars in expanded mode */}
          <ResponsiveContainer width="100%" height={280}>
            <BarChart
              data={dailyBalance}
              margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
              onClick={(state: unknown) => {
                const s = state as { activeLabel?: string } | null;
                if (!s?.activeLabel) return;
                const day = parseInt(s.activeLabel, 10);
                if (!Number.isFinite(day)) return;
                setSelectedDays((prev) => {
                  const next = new Set(prev);
                  if (next.has(day)) next.delete(day); else next.add(day);
                  return next;
                });
              }}
            >
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
                tickFormatter={formatAxisCurrency}
              />
              <Tooltip
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8125rem' }}
                cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                labelFormatter={(label: string) => `${MONTH_NAMES[month]} ${label}`}
                formatter={(value: number, name: string) => [formatCurrency(value), name]}
              />
              <Legend wrapperStyle={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }} />
              <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]}>
                {dailyBalance.map((d) => (
                  <Cell
                    key={d.day}
                    fill={INCOME_COLOR}
                    fillOpacity={selectedDays.size === 0 || selectedDays.has(d.day) ? 1 : 0.3}
                  />
                ))}
              </Bar>
              <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]}>
                {dailyBalance.map((d) => (
                  <Cell
                    key={d.day}
                    fill={EXPENSE_COLOR}
                    fillOpacity={selectedDays.size === 0 || selectedDays.has(d.day) ? 1 : 0.3}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div style={{ flex: '1 1 240px' }}>
          <MonthTotalsBar income={totalIncome} expenses={totalExpenses} />
        </div>
      </div>

      {/* Category summary for the month */}
      {categoryTotals.size > 0 && (
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <h3 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
            {monthLabel} summary
          </h3>
          {totalIncome > 0 && (
            <div style={{ marginBottom: 12 }}>
              <span
                className="chip"
                style={{
                  background: 'var(--success-bg)',
                  color: 'var(--success)',
                  border: '1px solid rgba(74,222,128,0.25)',
                  padding: '4px 10px',
                }}
              >
                Income: {formatCurrency(totalIncome)}
              </span>
            </div>
          )}
          <CategoryChipRow
            chips={[...categoryTotals.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([cat, total]) => ({
                key: cat,
                label: `${cat}: ${formatCurrency(total)}`,
              }))}
            isActive={(c) => selectedCategories === null || selectedCategories.has(c)}
            onToggle={(c) => setSelectedCategories((prev) => {
              const base = prev ?? new Set(Array.from(categoryTotals.keys()));
              const next = new Set(base);
              if (next.has(c)) next.delete(c); else next.add(c);
              return next;
            })}
            onSelectAll={(allKeys) => setSelectedCategories(new Set(allKeys))}
            onDeselectAll={() => setSelectedCategories(new Set())}
          />
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

        {/* ── Task 14: day-filter indicator ───────────────────────────────── */}
        {selectedDays.size > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ color: 'var(--accent)', fontSize: '0.8125rem' }}>
              Filtering to {selectedDays.size} day{selectedDays.size !== 1 ? 's' : ''}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={() => setSelectedDays(new Set())}>Clear</button>
          </div>
        )}

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
            emptyMessage={
              selectedDays.size > 0 || selectedCategories !== null || searchQuery.trim()
                ? 'No entries match the active filters.'
                : `No activity recorded for ${monthLabel}.`
            }
            isActiveOwner={isActiveOwner}
          />
        )}
      </div>
    </>
  );
}

export default ExpandedMonthView;
