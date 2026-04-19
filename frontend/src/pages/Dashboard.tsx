import { useState, useEffect, useCallback } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { Transaction, IncomeEntry, TimeRange, Category } from '../types';
import {
  getTransactions,
  getIncome,
  bulkDelete,
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
  formatCurrency,
  MONTH_NAMES,
} from '../utils/dataProcessing';
import { getCategoryColor } from '../utils/categories';
import CategoryLineChart, { TIME_RANGE_LABELS } from '../components/charts/CategoryLineChart';
import ExpenseCategoryTable from '../components/dashboard/ExpenseCategoryTable';
import MonthlyBalanceView from '../components/dashboard/MonthlyBalanceView';
import ExpandedMonthView from '../components/dashboard/ExpandedMonthView';
import Toast from '../components/Toast';
import EmptyState from '../components/EmptyState';
import { useUserCategories } from '../hooks/useUserCategories';
import { useWorkspaces } from '../hooks/useWorkspaces';
import Layout from '../components/layout/Layout';
import DangerZone from '../components/DangerZone';
// Undo-toast payload: what was just deleted, so we can restore it if the
// user clicks Undo before the timeout fires.
interface PendingUndo {
  transactions: Transaction[];
  income: IncomeEntry[];
  label: string;
}

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

  const { activeInstanceId } = useWorkspaces();

  const refetchAll = useCallback(async () => {
    try {
      const [txns, inc] = await Promise.all([getTransactions(), getIncome()]);
      setTransactions(txns);
      setIncome(inc);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Initial load — wait until we know whether there's an active instance.
  // activeInstanceId is null until useWorkspaces resolves, so delay the first
  // fetch until it's set. When there's no instance, show empty gracefully.
  useEffect(() => {
    if (activeInstanceId === undefined) return; // still resolving (shouldn't happen with null init)
    setLoading(false);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Refetch whenever the active workspace changes (including first real load).
  useEffect(() => {
    if (!activeInstanceId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    refetchAll().finally(() => setLoading(false));
  }, [activeInstanceId, refetchAll]);

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

  // No active workspace yet — show a neutral empty state instead of an error.
  if (!activeInstanceId) {
    return (
      <Layout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400, flexDirection: 'column', gap: 12 }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>Select a workspace to view your dashboard.</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            You can create or join a workspace from the{' '}
            <a href="/settings" style={{ color: 'var(--accent)' }}>Settings</a> page.
          </span>
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

