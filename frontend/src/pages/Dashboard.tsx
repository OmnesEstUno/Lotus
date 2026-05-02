import { useState, useEffect, useCallback } from 'react';
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortableListReorder } from '../hooks/useSortableListReorder';
import { Transaction, IncomeEntry, TimeRange, Category, CustomDateRange } from '../types';
import {
  getTransactions,
  addTransactions,
  updateTransaction,
  bulkUpdateCategory,
  bulkDelete,
} from '../api/transactions';
import type { AddTransactionInput } from '../api/transactions';
import {
  getIncome,
  addIncome,
  updateIncome,
} from '../api/income';
import type { AddIncomeInput } from '../api/income';
import { derivePattern } from '../utils/categorization/rules';
import { runMutation } from '../utils/mutation';
import { parseISO } from 'date-fns';
import { buildMonthlyExpenseTable } from '../utils/dataProcessing/monthlyExpenseTable';
import { buildMonthlyBalance } from '../utils/dataProcessing/monthlyBalance';
import { buildCategoryAverages } from '../utils/dataProcessing/categoryAverages';
import { filterByRange, formatCurrency, getTrackedDuration } from '../utils/dataProcessing/shared';
import { MONTH_NAMES_SHORT } from '../utils/dateConstants';
import { getCategoryColor } from '../utils/categorization/colors';
import { useColorBlindMode } from '../hooks/useColorBlindMode';
import CategoryLineChart from '../components/charts/CategoryLineChart';
import ExpenseCategoryTable from '../components/dashboard/ExpenseCategoryTable';
import TimeRangeSelector from '../components/dashboard/TimeRangeSelector';
import YearSelector, { CUSTOM_RANGE } from '../components/dashboard/YearSelector';
import DateRangePicker from '../components/DateRangePicker';
import AllTransactionsCard from '../components/dashboard/AllTransactionsCard';
import MonthlyBalanceView from '../components/dashboard/MonthlyBalanceView';
import NetBalanceView from '../components/dashboard/NetBalanceView';
import ExpandedMonthView from '../components/dashboard/ExpandedMonthView';
import DashboardCard from '../components/dashboard/DashboardCard';
import Toast from '../components/Toast';
import EmptyState from '../components/EmptyState';
import { useUserCategories } from '../hooks/useUserCategories';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useDashboardLayout, CardId } from '../hooks/useDashboardLayout';
import Layout from '../components/layout/Layout';
import { useDataEntry } from '../contexts/DataEntryContext';
import { YEAR_LOOKBACK, TRANSACTION_UPLOAD_CHUNK_SIZE } from '../utils/constants';
import { dialog } from '../utils/dialog';

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
  const [customRange, setCustomRange] = useState<CustomDateRange | null>(null);
  const [expandedCategory, setExpandedCategory] = useState<Category | null>(null);
  const [expandedMonth, setExpandedMonth] = useState<{ year: number; month: number } | null>(null);
  const [expenseYear, setExpenseYear] = useState(new Date().getFullYear());
  const [expenseRange, setExpenseRange] = useState<CustomDateRange | null>(null);
  const [avgRange, setAvgRange] = useState<CustomDateRange | null>(null);
  const [avgYear, setAvgYear] = useState(new Date().getFullYear());
  const [incomeYear, setIncomeYear] = useState(new Date().getFullYear());

  // Undo toast — populated right after a successful delete
  const [pendingUndo, setPendingUndo] = useState<PendingUndo | null>(null);

  // Conflict toast — shown when a 409 is received from a write endpoint
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);

  // Custom categories used by the edit flow
  const { userCategories, addCustomCategory } = useUserCategories();
  useColorBlindMode();

  const { activeInstanceId, isActiveOwner } = useWorkspaces();

  // Card layout state: order + which cards are minimized + which are hidden.
  // Persisted per active workspace so each instance remembers its own layout.
  const {
    cardOrder,
    setCardOrder,
    minimized: minimizedCards,
    toggleMinimized,
    hidden,
  } = useDashboardLayout(activeInstanceId);

  // Drag sensors + drag-end handler via shared hook (MouseSensor / TouchSensor
  // long-press / KeyboardSensor for a11y).
  const { sensors, onDragEnd: handleDragEnd } = useSortableListReorder(cardOrder, setCardOrder);

  const refetchAll = useCallback(async () => {
    try {
      const [txns, inc] = await Promise.all([getTransactions(), getIncome()]);
      setTransactions(txns);
      setIncome(inc);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // Refetch when data entry modal submits successfully
  const { onSubmitted } = useDataEntry();
  useEffect(() => {
    return onSubmitted(() => { refetchAll(); });
  }, [onSubmitted, refetchAll]);

  // Initial load — wait until we know whether there's an active instance.
  // activeInstanceId is null until useWorkspaces resolves, so delay the first
  // fetch until it's set. When there's no instance, show empty gracefully.
  useEffect(() => {
    if (activeInstanceId === undefined) return; // still resolving (shouldn't happen with null init)
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount only;
  // adding activeInstanceId would re-trigger on every workspace switch, fighting the effect below.
  }, []);

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

      await runMutation({
        call: () => bulkDelete(txnIds, incIds),
        onSuccess: async () => {
          await refetchAll();
          // Arm the undo toast
          setPendingUndo({ transactions: deletedTxns, income: deletedInc, label });
        },
        onConflict: async (msg) => { await refetchAll(); setConflictMessage(msg); },
        onError: (msg) => dialog.alert(`Delete failed: ${msg}`),
        conflictMessage: 'Data was changed by another tab — please retry your action.',
      });
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
    await runMutation({
      call: async () => {
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
          for (let i = 0; i < payload.length; i += TRANSACTION_UPLOAD_CHUNK_SIZE) {
            await addTransactions(payload.slice(i, i + TRANSACTION_UPLOAD_CHUNK_SIZE));
          }
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
      },
      onSuccess: async () => { await refetchAll(); },
      onConflict: async (msg) => { await refetchAll(); setConflictMessage(msg); },
      onError: (msg) => dialog.alert(`Undo failed: ${msg}`),
      onFinally: () => setPendingUndo(null),
      conflictMessage: 'Data was changed by another tab — please retry the undo.',
    });
  }, [pendingUndo, refetchAll]);

  /**
   * Update wrapper for inline edit. Dispatches to updateTransaction or
   * updateIncome based on row kind, then refetches.
   */
  const handleUpdateTransaction = useCallback(
    async (id: string, updates: Parameters<typeof updateTransaction>[1]) => {
      const prev = transactions.find((t) => t.id === id);
      await runMutation({
        call: () => updateTransaction(id, updates),
        onSuccess: async () => {
          // If the category changed, offer to apply it to other transactions with a
          // matching derived description pattern. Skips built-in income rows and
          // anything already in the new category.
          if (
            prev &&
            updates.category &&
            updates.category !== prev.category &&
            prev.type === 'expense'
          ) {
            const pattern = derivePattern(prev.description);
            const patternLower = pattern.toLowerCase();
            const matches = transactions.filter(
              (t) =>
                t.id !== id &&
                !t.archived &&
                t.type === 'expense' &&
                t.category === prev.category &&
                t.description.toLowerCase().includes(patternLower),
            );
            if (
              matches.length > 0 &&
              await dialog.confirm(
                `Apply "${updates.category}" to ${matches.length} other transaction${matches.length !== 1 ? 's' : ''} matching "${pattern}"?`,
              )
            ) {
              await bulkUpdateCategory(pattern, updates.category, prev.category);
            }
          }
          await refetchAll();
        },
        onConflict: async (msg) => { await refetchAll(); setConflictMessage(msg); },
        onError: (msg) => dialog.alert(`Update failed: ${msg}`),
        conflictMessage: 'Data was changed by another tab — please retry your update.',
      });
    },
    [transactions, refetchAll],
  );

  const handleUpdateIncome = useCallback(
    async (id: string, updates: Parameters<typeof updateIncome>[1]) => {
      await runMutation({
        call: () => updateIncome(id, updates),
        onSuccess: () => refetchAll(),
        onConflict: async (msg) => { await refetchAll(); setConflictMessage(msg); },
        onError: (msg) => dialog.alert(`Update failed: ${msg}`),
        conflictMessage: 'Data was changed by another tab — please retry your update.',
      });
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

  const monthlyResult = buildMonthlyExpenseTable(
    transactions,
    expenseRange ?? expenseYear,
  );
  const monthlyTable = monthlyResult.rows;
  const monthColumns = monthlyResult.columns;
  const monthlyBalance = buildMonthlyBalance(transactions, income, incomeYear);
  const categoryAveragesRanged = avgRange
    ? buildCategoryAverages(filterByRange(transactions, avgRange))
    : buildCategoryAverages(
        transactions.filter((t) => parseISO(t.date).getFullYear() === avgYear),
      );

  // Map each card id to its rendered node. Rendered inside a SortableContext
  // below in the saved order.
  function renderCard(id: CardId) {
    const isMin = minimizedCards.has(id);
    const toggle = () => toggleMinimized(id);

    switch (id) {
      case 'spending-trends':
        return (
          <DashboardCard
            key={id}
            id={id}
            title="Spending Trends"
            minimized={isMin}
            onToggleMinimize={toggle}
            headerActions={<TimeRangeSelector value={timeRange} onChange={setTimeRange} />}
          >
            {transactions.length === 0 ? (
              <EmptyState message="No transactions yet. Upload a CSV or add entries manually." />
            ) : (
              <CategoryLineChart
                transactions={transactions}
                timeRange={timeRange}
                customRange={customRange}
                onCustomRangeChange={setCustomRange}
              />
            )}
          </DashboardCard>
        );

      case 'expenses-by-category':
        return (
          <DashboardCard
            key={id}
            id={id}
            title="Expenses by Category"
            minimized={isMin}
            onToggleMinimize={toggle}
            headerActions={
              <>
                <YearSelector
                  transactions={transactions}
                  value={expenseRange ? CUSTOM_RANGE : expenseYear}
                  onChange={(y) => {
                    if (y === CUSTOM_RANGE) {
                      const today = new Date();
                      setExpenseRange({
                        start: `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
                        end: today.toISOString().slice(0, 10),
                      });
                    } else {
                      setExpenseRange(null);
                      setExpenseYear(y);
                    }
                  }}
                  customOption
                />
                {expandedCategory && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setExpandedCategory(null)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back to all categories
                  </button>
                )}
              </>
            }
          >
            {expenseRange && (() => {
              const today = new Date();
              const tenYearsAgo = new Date(today.getFullYear() - YEAR_LOOKBACK, today.getMonth(), today.getDate());
              const oldest = transactions.filter((t) => !t.archived).map((t) => t.date).sort()[0];
              const tenYrStr = tenYearsAgo.toISOString().slice(0, 10);
              const minDate = oldest && oldest > tenYrStr ? oldest : tenYrStr;
              return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <DateRangePicker
                    value={expenseRange}
                    onChange={setExpenseRange}
                    minDate={minDate}
                    maxDate={today.toISOString().slice(0, 10)}
                  />
                </div>
              );
            })()}
            {monthlyTable.length === 0 ? (
              <EmptyState
                message={
                  expenseRange
                    ? 'No expense data for the selected range.'
                    : `No expense data for ${expenseYear}.`
                }
              />
            ) : (
              <ExpenseCategoryTable
                monthlyTable={monthlyTable}
                columns={monthColumns}
                transactions={transactions}
                expandedCategory={expandedCategory}
                onSelect={(c) => setExpandedCategory(c === expandedCategory ? null : c)}
                onDelete={handleDelete}
                onUpdateTransaction={handleUpdateTransaction}
                userCategories={userCategories}
                addCustomCategory={addCustomCategory}
                isActiveOwner={isActiveOwner}
              />
            )}
          </DashboardCard>
        );

      case 'income-vs-expenditures':
        return (
          <DashboardCard
            key={id}
            id={id}
            title={
              <>
                Income vs. Expenditures
                {expandedMonth !== null && (
                  <span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 8 }}>
                    / {MONTH_NAMES_SHORT[expandedMonth.month]} {expandedMonth.year}
                  </span>
                )}
              </>
            }
            minimized={isMin}
            onToggleMinimize={toggle}
            headerActions={
              <>
                <YearSelector
                  transactions={transactions}
                  incomeEntries={income}
                  value={incomeYear}
                  onChange={(y) => { setIncomeYear(y); setExpandedMonth(null); }}
                  allowAllTime
                />
                {expandedMonth !== null && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setExpandedMonth(null)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                    Back to full year
                  </button>
                )}
              </>
            }
          >
            {monthlyBalance.length === 0 ? (
              <EmptyState message={incomeYear === -1 ? 'No data yet.' : `No data for ${incomeYear} yet.`} />
            ) : expandedMonth === null ? (
              <>
                <MonthlyBalanceView
                  monthlyBalance={monthlyBalance}
                  onMonthClick={(y, m) => setExpandedMonth({ year: y, month: m })}
                />
                <div style={{ marginTop: 16 }}>
                  <h3 style={{ color: 'var(--text-secondary)', marginBottom: 8, fontSize: '1rem' }}>Net Balance</h3>
                  <NetBalanceView monthlyBalance={monthlyBalance} />
                </div>
              </>
            ) : (
              <ExpandedMonthView
                transactions={transactions}
                incomeEntries={income}
                year={expandedMonth.year}
                month={expandedMonth.month}
                onDelete={handleDelete}
                onUpdateTransaction={handleUpdateTransaction}
                onUpdateIncome={handleUpdateIncome}
                userCategories={userCategories}
                addCustomCategory={addCustomCategory}
                isActiveOwner={isActiveOwner}
              />
            )}
          </DashboardCard>
        );

      case 'avg-expenditures':
        return (
          <DashboardCard
            key={id}
            id={id}
            title="Average Monthly Expenditures"
            minimized={isMin}
            onToggleMinimize={toggle}
            headerActions={
              <>
                <YearSelector
                  transactions={transactions}
                  value={avgRange ? CUSTOM_RANGE : avgYear}
                  onChange={(y) => {
                    if (y === CUSTOM_RANGE) {
                      const today = new Date();
                      setAvgRange({
                        start: `${today.getFullYear() - 1}-${String(today.getMonth() + 1).padStart(2, '0')}-01`,
                        end: today.toISOString().slice(0, 10),
                      });
                    } else {
                      setAvgRange(null);
                      setAvgYear(y);
                    }
                  }}
                  customOption
                />
                <span className="text-xs text-muted">
                  Over {categoryAveragesRanged[0]?.months ?? 0} month{(categoryAveragesRanged[0]?.months ?? 0) !== 1 ? 's' : ''} of data
                </span>
              </>
            }
          >
            {avgRange && (() => {
              const today = new Date();
              const tenYearsAgo = new Date(today.getFullYear() - YEAR_LOOKBACK, today.getMonth(), today.getDate());
              const oldest = transactions.filter((t) => !t.archived).map((t) => t.date).sort()[0];
              const tenYrStr = tenYearsAgo.toISOString().slice(0, 10);
              const minDate = oldest && oldest > tenYrStr ? oldest : tenYrStr;
              return (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
                  <DateRangePicker
                    value={avgRange}
                    onChange={setAvgRange}
                    minDate={minDate}
                    maxDate={today.toISOString().slice(0, 10)}
                  />
                </div>
              );
            })()}
            {categoryAveragesRanged.length === 0 ? (
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
                        <th style={{ width: '50%' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryAveragesRanged
                        .sort((a, b) => b.avgPerMonth - a.avgPerMonth)
                        .map((row) => {
                          const maxAvg = categoryAveragesRanged.reduce((m, r) => Math.max(m, r.avgPerMonth), 0);
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
                                <div className="progress-bar-track" style={{ height: 14 }}>
                                  <div
                                    className="progress-bar-fill"
                                    style={{
                                      width: `${pct}%`,
                                      background: getCategoryColor(row.category),
                                      height: 14,
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
              </>
            )}
          </DashboardCard>
        );

      case 'all-transactions':
        return (
          <AllTransactionsCard
            key={id}
            cardId={id}
            minimized={isMin}
            onToggleMinimize={toggle}
            transactions={transactions}
            userCategories={userCategories}
            addCustomCategory={addCustomCategory}
            onUpdateTransaction={handleUpdateTransaction}
            onDelete={handleDelete}
            isActiveOwner={isActiveOwner}
          />
        );
    }
  }

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
          <div className="stat-label">Transactions Tracked Over:</div>
          <div className="stat-value" style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span>{transactions.length.toLocaleString()}</span>
            {transactions.length > 0 && (() => {
              const duration = getTrackedDuration(transactions);
              return (
                <span style={{ color: 'var(--text-secondary)' }}>
                  {duration.years}YR, {duration.months}MO
                </span>
              );
            })()}
          </div>
        </div>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cardOrder.filter((id) => !hidden.has(id))} strategy={verticalListSortingStrategy}>
          {cardOrder.filter((id) => !hidden.has(id)).map(renderCard)}
        </SortableContext>
      </DndContext>

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

      {/* Conflict toast — shown when a 409 stale-write is detected */}
      {conflictMessage && !pendingUndo && (
        <Toast
          message={conflictMessage}
          onDismiss={() => setConflictMessage(null)}
          duration={6000}
        />
      )}
    </Layout>
  );
}
