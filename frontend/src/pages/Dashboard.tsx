import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { parseISO, subMonths } from 'date-fns';
import { Transaction, IncomeEntry, TimeRange, Category, UserCategories } from '../types';
import {
  getTransactions,
  getIncome,
  bulkDelete,
  purgeAllData,
  addTransactions,
  addIncome,
  updateTransaction,
  updateIncome,
  AddTransactionInput,
  AddIncomeInput,
} from '../api/client';
import {
  buildMonthlyExpenseTable,
  buildMonthlyBalance,
  buildCategoryAverages,
  buildDailyBalance,
  buildMonthEvents,
  formatCurrency,
} from '../utils/dataProcessing';
import { getCategoryColor } from '../utils/categories';
import CategoryLineChart, { TIME_RANGE_LABELS } from '../components/charts/CategoryLineChart';
import CategorySelect, { NEW_CATEGORY_SENTINEL } from '../components/CategorySelect';
import Toast from '../components/Toast';
import { useUserCategories } from '../hooks/useUserCategories';
import Layout from '../components/layout/Layout';

type DrillDownRange = 'year' | 'last12' | 'last3' | 'all';
const DRILL_DOWN_RANGE_LABELS: Record<DrillDownRange, string> = {
  year: 'This year',
  last12: 'Last 12 months',
  last3: 'Last 3 months',
  all: 'All time',
};

// Undo-toast payload: what was just deleted, so we can restore it if the
// user clicks Undo before the timeout fires.
interface PendingUndo {
  transactions: Transaction[];
  income: IncomeEntry[];
  label: string;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [income, setIncome] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('year');
  const [expandedCategory, setExpandedCategory] = useState<Category | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(null);

  // Undo toast — populated right after a successful delete
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);

  // Custom categories used by the edit flow
  const { userCategories, addCustomCategory } = useUserCategories();

  const refetchAll = useCallback(async () => {
    try {
      const [txns, inc] = await Promise.all([getTransactions(), getIncome()]);
      setTransactions(txns);
      setIncome(inc);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refetchAll().finally(() => setLoading(false));
  }, [refetchAll]);

  /**
   * Delete wrapper: captures the full rows being deleted (for undo), then
   * calls bulkDelete and shows the undo toast. The caller just provides the
   * IDs + a short label.
   */
  const handleDelete = useCallback(
    async (txnIds: string[], incIds: string[], label: string) => {
      // Snapshot the rows we're about to delete — we need the full objects
      // (not just IDs) to restore them on undo.
      const deletedTxns = transactions.filter((t) => txnIds.includes(t.id));
      const deletedInc = income.filter((e) => incIds.includes(e.id));

      try {
        await bulkDelete(txnIds, incIds);
        await refetchAll();
        // Arm the undo toast
        setPendingUndo({ transactions: deletedTxns, income: deletedInc, label });
      } catch (err) {
        window.alert(`Delete failed: ${(err as Error).message}`);
      }
    },
    [transactions, income, refetchAll],
  );

  /**
   * Undo handler — re-POSTs the previously-deleted rows with
   * allowDuplicate=true so the server's dedup doesn't reject them. Transactions
   * go through addTransactions (batch), income entries go one at a time.
   */
  const handleUndo = useCallback(async () => {
    if (!pendingUndo) return;
    try {
      if (pendingUndo.transactions.length > 0) {
        const payload: AddTransactionInput[] = pendingUndo.transactions.map((t) => ({
          date: t.date,
          description: t.description,
          category: t.category,
          amount: t.amount,
          type: t.type,
          source: t.source,
          allowDuplicate: true,
        }));
        await addTransactions(payload);
      }
      for (const e of pendingUndo.income) {
        const payload: AddIncomeInput = {
          date: e.date,
          description: e.description,
          grossAmount: e.grossAmount,
          netAmount: e.netAmount,
          taxes: e.taxes,
          source: e.source,
          allowDuplicate: true,
        };
        await addIncome(payload);
      }
      await refetchAll();
    } catch (err) {
      window.alert(`Undo failed: ${(err as Error).message}`);
    } finally {
      setPendingUndo(null);
    }
  }, [pendingUndo, refetchAll]);

  /**
   * Update wrapper for inline edit. Dispatches to updateTransaction or
   * updateIncome based on row kind, then refetches.
   */
  const handleUpdateTransaction = useCallback(
    async (id: string, updates: Parameters<typeof updateTransaction>[1]) => {
      try {
        await updateTransaction(id, updates);
        await refetchAll();
      } catch (err) {
        window.alert(`Update failed: ${(err as Error).message}`);
      }
    },
    [refetchAll],
  );

  const handleUpdateIncome = useCallback(
    async (id: string, updates: Parameters<typeof updateIncome>[1]) => {
      try {
        await updateIncome(id, updates);
        await refetchAll();
      } catch (err) {
        window.alert(`Update failed: ${(err as Error).message}`);
      }
    },
    [refetchAll],
  );

  if (loading) {
    return (
      <Layout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, gap: 16 }}>
          <div className="spinner" />
          <span style={{ color: 'var(--text-muted)' }}>Loading your financial data…</span>
        </div>
      </Layout>
    );
  }

  if (error) {
    return (
      <Layout>
        <div className="alert alert-danger">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      </Layout>
    );
  }

  const expenses = transactions.filter((t) => t.type === 'expense');
  const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalIncome = income.reduce((s, e) => s + e.netAmount, 0);
  const surplus = totalIncome - totalExpenses;

  const monthlyTable = buildMonthlyExpenseTable(transactions);
  const monthlyBalance = buildMonthlyBalance(transactions, income);
  const categoryAverages = buildCategoryAverages(transactions);
  const currentMonth = new Date().getMonth();

  return (
    <Layout>
      {/* ─── Summary Stats ─────────────────────────────────────── */}
      <div className="stat-grid" style={{ marginBottom: 32 }}>
        <div className="stat-card">
          <div className="stat-label">Total Expenses (All Time)</div>
          <div className="stat-value text-danger">{formatCurrency(totalExpenses)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Total Income Recorded</div>
          <div className="stat-value text-success">{formatCurrency(totalIncome)}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Net Surplus / Deficit</div>
          <div className={`stat-value ${surplus >= 0 ? 'text-success' : 'text-danger'}`}>
            {formatCurrency(surplus)}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Transactions Tracked</div>
          <div className="stat-value">{transactions.length.toLocaleString()}</div>
        </div>
      </div>

      {/* ─── Section 1: Spending Trends ──────────────────────────── */}
      <div className="section">
        <div className="card">
          <div className="card-header">
            <h2>Spending Trends</h2>
            <div className="tabs">
              {(Object.keys(TIME_RANGE_LABELS) as TimeRange[]).map((r) => (
                <button
                  key={r}
                  className={`tab ${timeRange === r ? 'active' : ''}`}
                  onClick={() => setTimeRange(r)}
                >
                  {TIME_RANGE_LABELS[r]}
                </button>
              ))}
            </div>
          </div>
          {transactions.length === 0 ? (
            <EmptyState message="No transactions yet. Upload a CSV or add entries manually." />
          ) : (
            <CategoryLineChart transactions={transactions} timeRange={timeRange} />
          )}
        </div>
      </div>

      {/* ─── Section 2: Monthly Expense Table ────────────────────── */}
      <div className="section">
        <div className="card">
          <div className="card-header">
            <h2>Expenses by Category — {new Date().getFullYear()}</h2>
            {expandedCategory && (
              <button className="btn btn-ghost btn-sm" onClick={() => setExpandedCategory(null)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to all categories
              </button>
            )}
          </div>
          {monthlyTable.length === 0 ? (
            <EmptyState message={`No expense data for ${new Date().getFullYear()}.`} />
          ) : (
            <ExpenseCategoryTable
              monthlyTable={monthlyTable}
              transactions={transactions}
              currentMonth={currentMonth}
              expandedCategory={expandedCategory}
              onSelect={(c) => setExpandedCategory(c === expandedCategory ? null : c)}
              onDelete={handleDelete}
              onUpdateTransaction={handleUpdateTransaction}
              userCategories={userCategories}
              addCustomCategory={addCustomCategory}
            />
          )}
        </div>
      </div>

      {/* ─── Section 3: Income vs Expenditures ───────────────────── */}
      <div className="section">
        <div className="card">
          <div className="card-header">
            <h2>
              Income vs. Expenditures — {new Date().getFullYear()}
              {expandedMonth !== null && (
                <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                  / {MONTH_NAMES[expandedMonth]}
                </span>
              )}
            </h2>
            {expandedMonth !== null && (
              <button className="btn btn-ghost btn-sm" onClick={() => setExpandedMonth(null)}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
                Back to full year
              </button>
            )}
          </div>
          {monthlyBalance.length === 0 ? (
            <EmptyState message={`No data for ${new Date().getFullYear()} yet.`} />
          ) : expandedMonth === null ? (
            <MonthlyBalanceView
              monthlyBalance={monthlyBalance}
              onMonthClick={(idx) => setExpandedMonth(idx)}
            />
          ) : (
            <ExpandedMonthView
              transactions={transactions}
              incomeEntries={income}
              year={new Date().getFullYear()}
              month={expandedMonth}
              onDelete={handleDelete}
              onUpdateTransaction={handleUpdateTransaction}
              onUpdateIncome={handleUpdateIncome}
              userCategories={userCategories}
              addCustomCategory={addCustomCategory}
            />
          )}
        </div>
      </div>

      {/* ─── Section 4: Average Expenditures ─────────────────────── */}
      <div className="section">
        <div className="card">
          <div className="card-header">
            <h2>Average Monthly Expenditures</h2>
            <span className="text-xs text-muted">
              Over {categoryAverages[0]?.months ?? 0} month{(categoryAverages[0]?.months ?? 0) !== 1 ? 's' : ''} of data
            </span>
          </div>
          {categoryAverages.length === 0 ? (
            <EmptyState message="No expense data available yet." />
          ) : (
            <>
              <div className="table-wrapper" style={{ marginBottom: 24 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th className="num">Avg / Month</th>
                      <th className="num">Total</th>
                      <th style={{ width: 160 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {categoryAverages
                      .sort((a, b) => b.avgPerMonth - a.avgPerMonth)
                      .map((row) => {
                        const maxAvg = categoryAverages.reduce((m, r) => Math.max(m, r.avgPerMonth), 0);
                        const pct = maxAvg > 0 ? (row.avgPerMonth / maxAvg) * 100 : 0;
                        return (
                          <tr key={row.category}>
                            <td>
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
                              </span>
                            </td>
                            <td className="num">{formatCurrency(row.avgPerMonth)}</td>
                            <td className="num">{formatCurrency(row.total)}</td>
                            <td>
                              <div className="progress-bar-track">
                                <div
                                  className="progress-bar-fill"
                                  style={{
                                    width: `${pct}%`,
                                    background: getCategoryColor(row.category),
                                  }}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              {/* Horizontal bar chart */}
              <ResponsiveContainer width="100%" height={Math.max(250, categoryAverages.length * 36)}>
                <BarChart
                  layout="vertical"
                  data={categoryAverages.sort((a, b) => b.avgPerMonth - a.avgPerMonth)}
                  margin={{ top: 4, right: 24, left: 80, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fill: 'var(--text-muted)', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
                    axisLine={false}
                    tickLine={false}
                    width={75}
                  />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8125rem' }}
                    formatter={(value: number) => [formatCurrency(value), 'Avg/month']}
                  />
                  <Bar dataKey="avgPerMonth" name="Avg/month" radius={[0, 3, 3, 0]}>
                    {categoryAverages
                      .sort((a, b) => b.avgPerMonth - a.avgPerMonth)
                      .map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getCategoryColor(entry.category)} />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>

      {/* ─── Danger Zone: purge all data + export backup ─────────── */}
      <div className="section">
        <DangerZone
          transactions={transactions}
          income={income}
          userCategories={userCategories}
          onPurged={refetchAll}
        />
      </div>

      {/* Undo toast — rendered last so it sits on top of everything */}
      {pendingUndo && (
        <Toast
          message={pendingUndo.label}
          actionLabel="Undo"
          onAction={handleUndo}
          onDismiss={() => setPendingUndo(null)}
          duration={5000}
        />
      )}
    </Layout>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      style={{
        padding: '48px 24px',
        textAlign: 'center',
        color: 'var(--text-muted)',
        fontSize: '0.875rem',
      }}
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        style={{ margin: '0 auto 12px', opacity: 0.4 }}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M3 9h18" />
        <path d="M9 21V9" />
      </svg>
      <p>{message}</p>
    </div>
  );
}

// ─── Expandable Expense Category Table ─────────────────────────────────────

interface EditDraft {
  id: string;
  date: string;
  description: string;
  category: Category;
  amount: string; // input value, parsed on save
}

interface ExpenseCategoryTableProps {
  monthlyTable: Array<{ category: Category; months: number[]; total: number }>;
  transactions: Transaction[];
  currentMonth: number;
  expandedCategory: Category | null;
  onSelect: (category: Category) => void;
  onDelete: (txnIds: string[], incIds: string[], label: string) => Promise<void>;
  onUpdateTransaction: (id: string, updates: Parameters<typeof updateTransaction>[1]) => Promise<void>;
  userCategories: UserCategories;
  addCustomCategory: (name: string) => string | null;
}

function ExpenseCategoryTable({
  monthlyTable,
  transactions,
  currentMonth,
  expandedCategory,
  onSelect,
  onDelete,
  onUpdateTransaction,
  userCategories,
  addCustomCategory,
}: ExpenseCategoryTableProps) {
  const visibleRows = expandedCategory
    ? monthlyTable.filter((r) => r.category === expandedCategory)
    : monthlyTable;

  // Multi-select state for the drill-down. Cleared whenever the expanded
  // category changes (so selections don't leak between categories).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [drillDownRange, setDrillDownRange] = useState<DrillDownRange>('year');
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  useEffect(() => {
    setSelectedIds(new Set());
    setSearchQuery('');
    setEditDraft(null);
  }, [expandedCategory]);

  // Date range filter for the drill-down list only. The outer monthly table
  // always shows the current year — that's the contract of that section.
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

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (prev.size === categoryTransactions.length) return new Set();
      return new Set(categoryTransactions.map((t) => t.id));
    });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    const n = selectedIds.size;
    if (!window.confirm(`Delete ${n} selected transaction${n !== 1 ? 's' : ''}?`)) return;
    setBusy(true);
    try {
      await onDelete([...selectedIds], [], `Deleted ${n} transaction${n !== 1 ? 's' : ''} from ${expandedCategory}.`);
      setSelectedIds(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(t: Transaction) {
    if (!window.confirm(`Delete "${t.description}"?`)) return;
    setBusy(true);
    try {
      await onDelete([t.id], [], `Deleted "${t.description}".`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(t: Transaction) {
    setEditDraft({
      id: t.id,
      date: t.date,
      description: t.description,
      category: t.category,
      amount: Math.abs(t.amount).toFixed(2),
    });
  }

  function cancelEdit() {
    setEditDraft(null);
  }

  async function saveEdit() {
    if (!editDraft) return;
    const amt = parseFloat(editDraft.amount);
    if (isNaN(amt) || amt <= 0) {
      window.alert('Please enter a valid positive amount.');
      return;
    }
    setBusy(true);
    try {
      await onUpdateTransaction(editDraft.id, {
        date: editDraft.date,
        description: editDraft.description.trim(),
        category: editDraft.category,
        amount: -amt, // stored as negative for expenses
      });
      setEditDraft(null);
    } finally {
      setBusy(false);
    }
  }

  function handleEditCategoryPick(picked: string) {
    if (!editDraft) return;
    if (picked === NEW_CATEGORY_SENTINEL) {
      const input = window.prompt('Name for the new category:');
      if (!input) return;
      const name = addCustomCategory(input);
      if (!name) return;
      setEditDraft({ ...editDraft, category: name });
      return;
    }
    setEditDraft({ ...editDraft, category: picked });
  }

  return (
    <>
      <div className="table-wrapper">
        <table className="table">
          <thead>
            <tr>
              <th>Category</th>
              {MONTH_NAMES.slice(0, currentMonth + 1).map((m) => (
                <th key={m} className="num">{m}</th>
              ))}
              <th className="num">Total</th>
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
                    background: isExpanded ? 'var(--accent-dim)' : undefined,
                  }}
                  title={isExpanded ? 'Click to collapse' : 'Click to view transactions'}
                >
                  <td>
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
                  {row.months.slice(0, currentMonth + 1).map((amt, mi) => (
                    <td key={mi} className={`num ${amt === 0 ? 'zero' : ''}`}>
                      {amt > 0 ? formatCurrency(amt) : '—'}
                    </td>
                  ))}
                  <td className="num" style={{ fontWeight: 600 }}>
                    {formatCurrency(row.total)}
                  </td>
                </tr>
              );
            })}
            {!expandedCategory && (
              <tr style={{ background: 'var(--bg-elevated)', fontWeight: 600 }}>
                <td>Total</td>
                {MONTH_NAMES.slice(0, currentMonth + 1).map((_, mi) => {
                  const monthTotal = monthlyTable.reduce((s, r) => s + r.months[mi], 0);
                  return (
                    <td key={mi} className="num">
                      {monthTotal > 0 ? formatCurrency(monthTotal) : '—'}
                    </td>
                  );
                })}
                <td className="num">
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
              {selectedIds.size > 0 && (
                <button
                  className="btn btn-sm btn-danger"
                  onClick={deleteSelected}
                  disabled={busy}
                >
                  {busy ? <span className="spinner" /> : `Delete selected (${selectedIds.size})`}
                </button>
              )}
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

          {categoryTransactions.length === 0 ? (
            <p className="text-muted text-sm">
              {searchQuery.trim()
                ? `No transactions matching "${searchQuery}" in this category.`
                : 'No transactions in this category for the selected date range.'}
            </p>
          ) : (
            <div className="preview-scroll" style={{ maxHeight: 420 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.size === categoryTransactions.length && categoryTransactions.length > 0}
                        ref={(el) => {
                          if (el) {
                            el.indeterminate = selectedIds.size > 0 && selectedIds.size < categoryTransactions.length;
                          }
                        }}
                        onChange={toggleAll}
                        title="Select all / none"
                      />
                    </th>
                    <th>Date</th>
                    <th>Description</th>
                    <th>Category</th>
                    <th className="num">Amount</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {categoryTransactions.map((t) => {
                    const isSelected = selectedIds.has(t.id);
                    const isEditing = editDraft?.id === t.id;

                    if (isEditing) {
                      return (
                        <tr key={t.id} style={{ background: 'var(--accent-dim)' }}>
                          <td></td>
                          <td>
                            <input
                              type="date"
                              className="input"
                              style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                              value={editDraft.date}
                              onChange={(e) => setEditDraft({ ...editDraft, date: e.target.value })}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              className="input"
                              style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                              value={editDraft.description}
                              onChange={(e) => setEditDraft({ ...editDraft, description: e.target.value })}
                            />
                          </td>
                          <td>
                            <CategorySelect
                              value={editDraft.category}
                              customCategories={userCategories.customCategories}
                              onChange={handleEditCategoryPick}
                              compact
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              className="input num"
                              style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                              value={editDraft.amount}
                              onChange={(e) => setEditDraft({ ...editDraft, amount: e.target.value })}
                            />
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                className="btn btn-sm btn-primary"
                                onClick={saveEdit}
                                disabled={busy}
                                title="Save"
                                style={{ padding: '4px 8px' }}
                              >
                                ✓
                              </button>
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={cancelEdit}
                                disabled={busy}
                                title="Cancel"
                                style={{ padding: '4px 8px' }}
                              >
                                ✕
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={t.id} style={isSelected ? { background: 'var(--accent-dim)' } : undefined}>
                        <td>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleOne(t.id)}
                          />
                        </td>
                        <td className="text-sm font-mono" style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                        <td>{t.description}</td>
                        <td>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: getCategoryColor(t.category),
                                flexShrink: 0,
                              }}
                            />
                            {t.category}
                          </span>
                        </td>
                        <td className="num text-danger">{formatCurrency(Math.abs(t.amount))}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 2 }}>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => startEdit(t)}
                              disabled={busy}
                              title="Edit"
                              style={{ padding: '4px 8px' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                              </svg>
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => deleteOne(t)}
                              disabled={busy}
                              title="Delete"
                              style={{ padding: '4px 8px' }}
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="3 6 5 6 21 6" />
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─── Monthly balance: normal view ───────────────────────────────────────────

const SURPLUS_COLOR = '#7dd3fc'; // muted sky blue
const DEFICIT_COLOR = '#a78bfa'; // muted violet
const INCOME_COLOR = '#4ade80';
const EXPENSE_COLOR = '#f87171';

interface MonthlyBalanceViewProps {
  monthlyBalance: Array<{
    month: string;
    monthIndex: number;
    income: number;
    expenses: number;
    surplus: number;
  }>;
  onMonthClick: (monthIndex: number) => void;
}

function MonthlyBalanceView({ monthlyBalance, onMonthClick }: MonthlyBalanceViewProps) {
  return (
    <>
      {/* Numeric table — rows are clickable */}
      <div className="table-wrapper" style={{ marginBottom: 24 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Income</th>
              <th className="num">Expenses</th>
              <th className="num">Surplus / Deficit</th>
            </tr>
          </thead>
          <tbody>
            {monthlyBalance.map((row) => (
              <tr
                key={row.month}
                onClick={() => onMonthClick(row.monthIndex)}
                style={{ cursor: 'pointer' }}
                title="Click to drill down into this month"
              >
                <td>{row.month}</td>
                <td className="num text-success">{row.income > 0 ? formatCurrency(row.income) : <span className="zero">—</span>}</td>
                <td className="num text-danger">{row.expenses > 0 ? formatCurrency(row.expenses) : <span className="zero">—</span>}</td>
                <td className={`num ${row.surplus >= 0 ? 'text-success' : 'text-danger'}`}>
                  {(row.income > 0 || row.expenses > 0) ? formatCurrency(row.surplus) : <span className="zero">—</span>}
                </td>
              </tr>
            ))}
            {/* YTD totals */}
            <tr style={{ background: 'var(--bg-elevated)', fontWeight: 600 }}>
              <td>YTD Total</td>
              <td className="num text-success">
                {formatCurrency(monthlyBalance.reduce((s, r) => s + r.income, 0))}
              </td>
              <td className="num text-danger">
                {formatCurrency(monthlyBalance.reduce((s, r) => s + r.expenses, 0))}
              </td>
              <td className={`num ${monthlyBalance.reduce((s, r) => s + r.surplus, 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                {formatCurrency(monthlyBalance.reduce((s, r) => s + r.surplus, 0))}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Bar chart — click any column to drill down */}
      <ResponsiveContainer width="100%" height={280}>
        <BarChart
          data={monthlyBalance}
          margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
          onClick={(state: unknown) => {
            const s = state as { activePayload?: Array<{ payload?: { monthIndex?: number } }> } | null;
            const idx = s?.activePayload?.[0]?.payload?.monthIndex;
            if (typeof idx === 'number') onMonthClick(idx);
          }}
          style={{ cursor: 'pointer' }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
            axisLine={{ stroke: 'var(--border)' }}
            tickLine={false}
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
            formatter={(value: number, name: string) => {
              // Relabel the surplus bar as "Deficit" when the value is negative
              if (name === 'Surplus' && value < 0) return [formatCurrency(value), 'Deficit'];
              return [formatCurrency(value), name];
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}
            payload={[
              { value: 'Income', type: 'square', color: INCOME_COLOR, id: 'income' },
              { value: 'Expenses', type: 'square', color: EXPENSE_COLOR, id: 'expenses' },
              { value: 'Surplus', type: 'square', color: SURPLUS_COLOR, id: 'surplus' },
              { value: 'Deficit', type: 'square', color: DEFICIT_COLOR, id: 'deficit' },
            ]}
          />
          <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} />
          <Bar dataKey="expenses" name="Expenses" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} />
          <Bar dataKey="surplus" name="Surplus" radius={[3, 3, 0, 0]}>
            {monthlyBalance.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.surplus >= 0 ? SURPLUS_COLOR : DEFICIT_COLOR}
                fillOpacity={0.55}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </>
  );
}

// Axis tick formatter that handles negative values cleanly ("-$1k", "-$500")
function formatAxisCurrency(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  const short = abs >= 1000 ? `${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k` : String(abs);
  return `${sign}$${short}`;
}

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
}

interface MonthEditDraft {
  id: string;
  kind: 'expense' | 'income';
  date: string;
  description: string;
  category: Category; // only meaningful for expenses
  amount: string;
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
}: ExpandedMonthViewProps) {
  const dailyBalance = buildDailyBalance(transactions, incomeEntries, year, month);
  const events = buildMonthEvents(transactions, incomeEntries, year, month);

  // Multi-select state: composite keys like "txn:uuid" / "inc:uuid".
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [editDraft, setEditDraft] = useState<MonthEditDraft | null>(null);

  // Clear selection + search when the expanded month changes
  useEffect(() => {
    setSelectedKeys(new Set());
    setSearchQuery('');
    setEditDraft(null);
  }, [year, month]);

  // Search filter layered on top of the chronological event list
  const filteredEvents = searchQuery.trim()
    ? events.filter((e) => e.description.toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : events;

  const eventKey = (e: { kind: 'income' | 'expense'; id: string }) => `${e.kind === 'income' ? 'inc' : 'txn'}:${e.id}`;

  function toggleOne(e: { kind: 'income' | 'expense'; id: string }) {
    setSelectedKeys((prev) => {
      const k = eventKey(e);
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleAll() {
    setSelectedKeys((prev) => {
      if (prev.size === filteredEvents.length) return new Set();
      return new Set(filteredEvents.map((e) => eventKey(e)));
    });
  }

  function partitionSelection(): { txnIds: string[]; incIds: string[] } {
    const txnIds: string[] = [];
    const incIds: string[] = [];
    for (const k of selectedKeys) {
      const [kind, id] = k.split(':');
      if (kind === 'txn') txnIds.push(id);
      else if (kind === 'inc') incIds.push(id);
    }
    return { txnIds, incIds };
  }

  async function deleteSelected() {
    if (selectedKeys.size === 0) return;
    const n = selectedKeys.size;
    if (!window.confirm(`Delete ${n} selected entr${n !== 1 ? 'ies' : 'y'}?`)) return;
    const { txnIds, incIds } = partitionSelection();
    setBusy(true);
    try {
      await onDelete(txnIds, incIds, `Deleted ${n} entr${n !== 1 ? 'ies' : 'y'} from ${MONTH_NAMES[month]} ${year}.`);
      setSelectedKeys(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function deleteOne(e: { kind: 'income' | 'expense'; id: string; description: string }) {
    if (!window.confirm(`Delete "${e.description}"?`)) return;
    setBusy(true);
    try {
      if (e.kind === 'income') {
        await onDelete([], [e.id], `Deleted income entry "${e.description}".`);
      } else {
        await onDelete([e.id], [], `Deleted "${e.description}".`);
      }
    } finally {
      setBusy(false);
    }
  }

  function startEdit(e: { id: string; kind: 'income' | 'expense'; date: string; description: string; category?: Category; amount: number }) {
    setEditDraft({
      id: e.id,
      kind: e.kind,
      date: e.date,
      description: e.description,
      category: e.category ?? 'Other',
      amount: Math.abs(e.amount).toFixed(2),
    });
  }

  function cancelEdit() {
    setEditDraft(null);
  }

  async function saveEdit() {
    if (!editDraft) return;
    const amt = parseFloat(editDraft.amount);
    if (isNaN(amt) || amt <= 0) {
      window.alert('Please enter a valid positive amount.');
      return;
    }
    setBusy(true);
    try {
      if (editDraft.kind === 'expense') {
        await onUpdateTransaction(editDraft.id, {
          date: editDraft.date,
          description: editDraft.description.trim(),
          category: editDraft.category,
          amount: -amt,
        });
      } else {
        await onUpdateIncome(editDraft.id, {
          date: editDraft.date,
          description: editDraft.description.trim(),
          grossAmount: amt,
          netAmount: amt,
        });
      }
      setEditDraft(null);
    } finally {
      setBusy(false);
    }
  }

  function handleEditCategoryPick(picked: string) {
    if (!editDraft) return;
    if (picked === NEW_CATEGORY_SENTINEL) {
      const input = window.prompt('Name for the new category:');
      if (!input) return;
      const name = addCustomCategory(input);
      if (!name) return;
      setEditDraft({ ...editDraft, category: name });
      return;
    }
    setEditDraft({ ...editDraft, category: picked });
  }

  // Per-category totals for quick reference above the chronological list
  const categoryTotals = new Map<Category, number>();
  let incomeTotal = 0;
  events.forEach((e) => {
    if (e.kind === 'income') {
      incomeTotal += e.amount;
    } else if (e.category) {
      categoryTotals.set(e.category, (categoryTotals.get(e.category) ?? 0) + e.amount);
    }
  });

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
            {MONTH_NAMES[month]} {year} summary
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
              ({filteredEvents.length} of {events.length} entr{events.length !== 1 ? 'ies' : 'y'})
            </span>
          </h3>
          {selectedKeys.size > 0 && (
            <button
              className="btn btn-sm btn-danger"
              onClick={deleteSelected}
              disabled={busy}
            >
              {busy ? <span className="spinner" /> : `Delete selected (${selectedKeys.size})`}
            </button>
          )}
        </div>

        <input
          type="text"
          className="input"
          placeholder="Search descriptions…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ marginBottom: 12, maxWidth: 360 }}
        />

        {events.length === 0 ? (
          <p className="text-muted text-sm">No activity recorded for {MONTH_NAMES[month]} {year}.</p>
        ) : filteredEvents.length === 0 ? (
          <p className="text-muted text-sm">No entries matching "{searchQuery}".</p>
        ) : (
          <div className="preview-scroll" style={{ maxHeight: 420 }}>
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 32 }}>
                    <input
                      type="checkbox"
                      checked={selectedKeys.size === filteredEvents.length && filteredEvents.length > 0}
                      ref={(el) => {
                        if (el) {
                          el.indeterminate = selectedKeys.size > 0 && selectedKeys.size < filteredEvents.length;
                        }
                      }}
                      onChange={toggleAll}
                      title="Select all / none"
                    />
                  </th>
                  <th>Date</th>
                  <th>Type / Category</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((e) => {
                  const isSelected = selectedKeys.has(eventKey(e));
                  const isEditing = editDraft?.id === e.id;

                  if (isEditing) {
                    return (
                      <tr key={eventKey(e)} style={{ background: 'var(--accent-dim)' }}>
                        <td></td>
                        <td>
                          <input
                            type="date"
                            className="input"
                            style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                            value={editDraft.date}
                            onChange={(ev) => setEditDraft({ ...editDraft, date: ev.target.value })}
                          />
                        </td>
                        <td>
                          {editDraft.kind === 'expense' ? (
                            <CategorySelect
                              value={editDraft.category}
                              customCategories={userCategories.customCategories}
                              onChange={handleEditCategoryPick}
                              compact
                            />
                          ) : (
                            <span className="chip" style={{ background: 'var(--success-bg)', color: 'var(--success)', border: '1px solid rgba(74,222,128,0.25)' }}>
                              Income
                            </span>
                          )}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="input"
                            style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                            value={editDraft.description}
                            onChange={(ev) => setEditDraft({ ...editDraft, description: ev.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            className="input num"
                            style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                            value={editDraft.amount}
                            onChange={(ev) => setEditDraft({ ...editDraft, amount: ev.target.value })}
                          />
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button className="btn btn-sm btn-primary" onClick={saveEdit} disabled={busy} title="Save" style={{ padding: '4px 8px' }}>✓</button>
                            <button className="btn btn-sm btn-ghost" onClick={cancelEdit} disabled={busy} title="Cancel" style={{ padding: '4px 8px' }}>✕</button>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  return (
                    <tr key={eventKey(e)} style={isSelected ? { background: 'var(--accent-dim)' } : undefined}>
                      <td>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleOne(e)}
                        />
                      </td>
                      <td className="text-sm font-mono" style={{ whiteSpace: 'nowrap' }}>{e.date}</td>
                      <td>
                        {e.kind === 'income' ? (
                          <span
                            className="chip"
                            style={{
                              background: 'var(--success-bg)',
                              color: 'var(--success)',
                              border: '1px solid rgba(74,222,128,0.25)',
                            }}
                          >
                            Income
                          </span>
                        ) : (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                            <span
                              style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: e.category ? getCategoryColor(e.category) : 'var(--text-muted)',
                                flexShrink: 0,
                              }}
                            />
                            {e.category ?? 'Expense'}
                          </span>
                        )}
                      </td>
                      <td>{e.description}</td>
                      <td className={`num ${e.kind === 'income' ? 'text-success' : 'text-danger'}`}>
                        {e.kind === 'income' ? '+' : ''}{formatCurrency(e.amount)}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 2 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => startEdit(e)}
                            disabled={busy}
                            title="Edit"
                            style={{ padding: '4px 8px' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => deleteOne(e)}
                            disabled={busy}
                            title="Delete"
                            style={{ padding: '4px 8px' }}
                          >
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Danger Zone ─────────────────────────────────────────────────────────────
//
// Two data-management actions live here:
//   1. Export all data as a JSON backup (safe)
//   2. Permanently purge all transactions + income (destructive)
//
// The purge uses a typed-confirmation pattern (the user must type "DELETE"
// verbatim) so the button can't be triggered accidentally. Custom categories
// and mappings are preserved — this only affects financial data.

interface DangerZoneProps {
  transactions: Transaction[];
  income: IncomeEntry[];
  userCategories: UserCategories;
  onPurged: () => Promise<void>;
}

function DangerZone({ transactions, income, userCategories, onPurged }: DangerZoneProps) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  function reset() {
    setConfirming(false);
    setTyped('');
    setError('');
  }

  async function handlePurge() {
    setWorking(true);
    setError('');
    try {
      await purgeAllData();
      await onPurged();
      setSuccess('All transactions and income entries have been permanently deleted.');
      reset();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setWorking(false);
    }
  }

  /**
   * Build a self-contained JSON backup and trigger a download in the
   * browser. Contains everything needed to restore the user's state:
   * transactions, income, and custom categories + mappings.
   */
  function handleExport() {
    const payload = {
      exportedAt: new Date().toISOString(),
      app: 'Lotus',
      version: 1,
      transactions,
      income,
      userCategories,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lotus-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSuccess('Backup downloaded.');
  }

  const typedMatches = typed.trim() === 'DELETE';

  return (
    <div
      className="card"
      style={{
        borderColor: 'rgba(248,113,113,0.35)',
        background: 'rgba(248,113,113,0.03)',
      }}
    >
      <div className="card-header">
        <h2 style={{ color: 'var(--danger)' }}>Danger Zone</h2>
      </div>

      {success && (
        <div className="alert alert-success" style={{ marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          {success}
        </div>
      )}

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {error}
        </div>
      )}

      {/* Backup / export (safe) */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ color: 'var(--text-secondary)', marginBottom: 8 }}>Download backup</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 12, fontSize: '0.875rem' }}>
          Save a complete JSON backup of your transactions, income, and custom categories to
          your computer. Recommended before any destructive action.
        </p>
        <button className="btn btn-secondary" onClick={handleExport}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download JSON backup
        </button>
      </div>

      {/* Purge (destructive) */}
      <div style={{ borderTop: '1px solid rgba(248,113,113,0.2)', paddingTop: 20 }}>
        <h3 style={{ color: 'var(--danger)', marginBottom: 8 }}>Purge all data</h3>
        <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>
          Permanently delete all transactions and income entries from your account. Your custom
          categories and description mappings are preserved. <strong>This cannot be undone.</strong>
        </p>

        {!confirming ? (
          <button
            className="btn btn-danger"
            onClick={() => { setConfirming(true); setSuccess(''); }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
            Purge all data
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480 }}>
            <label className="form-label">
              Type <strong style={{ color: 'var(--danger)' }}>DELETE</strong> to confirm:
            </label>
            <input
              type="text"
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              autoFocus
              disabled={working}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-danger"
                onClick={handlePurge}
                disabled={!typedMatches || working}
              >
                {working ? <span className="spinner" /> : 'Permanently delete everything'}
              </button>
              <button className="btn btn-ghost" onClick={reset} disabled={working}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
