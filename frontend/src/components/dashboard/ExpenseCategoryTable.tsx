import { useState, useEffect } from 'react';
import { parseISO, subMonths } from 'date-fns';
import { Transaction, Category, UserCategories } from '../../types';
import { updateTransaction } from '../../api/transactions';
import { MonthColumn } from '../../utils/dataProcessing/monthlyExpenseTable';
import { formatCurrency } from '../../utils/dataProcessing/shared';
import { MONTH_NAMES_SHORT } from '../../utils/dateConstants';
import { getCategoryColor } from '../../utils/categorization/colors';
import { DrillDownRange, DRILL_DOWN_RANGE_LABELS } from './constants';
import TransactionDrillDown, { DrillDownEvent } from './TransactionDrillDown';

// ─── Expandable Expense Category Table ─────────────────────────────────────

interface ExpenseCategoryTableProps {
  monthlyTable: Array<{ category: Category; months: number[]; total: number }>;
  columns: MonthColumn[];
  transactions: Transaction[];
  expandedCategory: Category | null;
  onSelect: (category: Category) => void;
  onDelete: (txnIds: string[], incIds: string[], label: string) => Promise<void>;
  onUpdateTransaction: (id: string, updates: Parameters<typeof updateTransaction>[1]) => Promise<void>;
  userCategories: UserCategories;
  addCustomCategory: (name: string) => string | null;
  isActiveOwner?: boolean;
}

export default function ExpenseCategoryTable({
  monthlyTable,
  columns,
  transactions,
  expandedCategory,
  onSelect,
  onDelete,
  onUpdateTransaction,
  userCategories,
  addCustomCategory,
  isActiveOwner = true,
}: ExpenseCategoryTableProps) {
  const showYearSublabel = new Set(columns.map((c) => c.year)).size > 1;
  const visibleRows = expandedCategory
    ? monthlyTable.filter((r) => r.category === expandedCategory)
    : monthlyTable;

  const [searchQuery, setSearchQuery] = useState('');
  const [drillDownRange, setDrillDownRange] = useState<DrillDownRange>('year');

  useEffect(() => {
    setSearchQuery('');
  }, [expandedCategory]);

  // Date range filter for the drill-down list only.
  const { start: rangeStart, end: rangeEnd } = (() => {
    const now = new Date();
    switch (drillDownRange) {
      case 'year':
        return { start: new Date(now.getFullYear(), 0, 1), end: now };
      case 'last12':
        return { start: subMonths(now, 12), end: now };
      case 'last3':
        return { start: subMonths(now, 3), end: now };
      case 'all':
        return { start: new Date(2000, 0, 1), end: now };
    }
  })();

  const categoryTransactionsAll = expandedCategory
    ? transactions
        .filter((t) => {
          if (t.archived) return false;
          if (t.type !== 'expense') return false;
          if (t.category !== expandedCategory) return false;
          const d = parseISO(t.date);
          return d >= rangeStart && d <= rangeEnd;
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

  // Text search filter layered on top of the date range filter
  const categoryTransactions = searchQuery.trim()
    ? categoryTransactionsAll.filter((t) =>
        t.description.toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : categoryTransactionsAll;

  // Transform Transaction[] into the unified DrillDownEvent[] shape
  const drillDownEvents: DrillDownEvent[] = categoryTransactions.map((t) => ({
    id: t.id,
    kind: 'expense',
    date: t.date,
    description: t.description,
    category: t.category,
    amount: Math.abs(t.amount),
    notes: t.notes,
  }));

  const emptyMessage = searchQuery.trim()
    ? `No transactions matching "${searchQuery}" in this category.`
    : 'No transactions in this category for the selected date range.';

  return (
    <>
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th className="sticky-col-left">Category</th>
              {columns.map((c, ci) => (
                <th key={ci} className="num">
                  <div>{MONTH_NAMES_SHORT[c.month]}</div>
                  {showYearSublabel && (
                    <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-muted)' }}>
                      {c.year}
                    </div>
                  )}
                </th>
              ))}
              <th className="num sticky-col-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const isExpanded = expandedCategory === row.category;
              return (
                <tr
                  key={row.category}
                  onClick={() => onSelect(row.category)}
                  style={{
                    cursor: 'pointer',
                    background: isExpanded ? 'var(--accent-dim)' : 'var(--bg-card)',
                  }}
                  title={isExpanded ? 'Click to collapse' : 'Click to view transactions'}
                >
                  <td className="sticky-col-left">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: getCategoryColor(row.category),
                          flexShrink: 0,
                        }}
                      />
                      {row.category}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{ opacity: 0.5, transform: isExpanded ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </span>
                  </td>
                  {row.months.map((amt, mi) => (
                    <td key={mi} className={`num ${amt === 0 ? 'zero' : ''}`}>
                      {amt > 0 ? formatCurrency(amt) : '—'}
                    </td>
                  ))}
                  <td className="num sticky-col-right" style={{ fontWeight: 600 }}>
                    {formatCurrency(row.total)}
                  </td>
                </tr>
              );
            })}
            {!expandedCategory && (
              <tr style={{ background: 'var(--bg-elevated)', fontWeight: 600 }}>
                <td className="sticky-col-left">Total</td>
                {columns.map((_, mi) => {
                  const monthTotal = monthlyTable.reduce((s, r) => s + r.months[mi], 0);
                  return (
                    <td key={mi} className="num">
                      {monthTotal > 0 ? formatCurrency(monthTotal) : '—'}
                    </td>
                  );
                })}
                <td className="num sticky-col-right">
                  {formatCurrency(monthlyTable.reduce((s, r) => s + r.total, 0))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Transaction drill-down list */}
      {expandedCategory && (
        <div style={{ marginTop: 20, borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap' }}>
            <h3 style={{ color: 'var(--text-secondary)' }}>
              Transactions in {expandedCategory}
              <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
                ({categoryTransactions.length} record{categoryTransactions.length !== 1 ? 's' : ''})
              </span>
            </h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select
                className="select"
                style={{ padding: '5px 10px', fontSize: '0.8125rem', width: 'auto' }}
                value={drillDownRange}
                onChange={(e) => setDrillDownRange(e.target.value as DrillDownRange)}
              >
                {(Object.keys(DRILL_DOWN_RANGE_LABELS) as DrillDownRange[]).map((r) => (
                  <option key={r} value={r}>{DRILL_DOWN_RANGE_LABELS[r]}</option>
                ))}
              </select>
            </div>
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
            events={drillDownEvents}
            onDeleteMany={(txnIds, incIds) =>
              onDelete(txnIds, incIds, `Deleted ${txnIds.length} transaction${txnIds.length !== 1 ? 's' : ''} from ${expandedCategory}.`)
            }
            onDeleteOne={(event) =>
              onDelete([event.id], [], `Deleted "${event.description}".`)
            }
            onUpdateTransaction={onUpdateTransaction}
            userCategories={userCategories}
            addCustomCategory={addCustomCategory}
            emptyMessage={emptyMessage}
            isActiveOwner={isActiveOwner}
          />
        </div>
      )}
    </>
  );
}
