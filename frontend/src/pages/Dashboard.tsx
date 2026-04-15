import { useState, useEffect } from 'react';
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
import { parseISO } from 'date-fns';
import { Transaction, IncomeEntry, TimeRange, Category } from '../types';
import { getTransactions, getIncome } from '../api/client';
import {
  buildMonthlyExpenseTable,
  buildMonthlyBalance,
  buildCategoryAverages,
  formatCurrency,
} from '../utils/dataProcessing';
import { CATEGORY_COLORS } from '../utils/categories';
import CategoryLineChart, { TIME_RANGE_LABELS } from '../components/charts/CategoryLineChart';
import Layout from '../components/layout/Layout';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function Dashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [income, setIncome] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [timeRange, setTimeRange] = useState<TimeRange>('year');
  const [expandedCategory, setExpandedCategory] = useState<Category | null>(null);

  useEffect(() => {
    Promise.all([getTransactions(), getIncome()])
      .then(([txns, inc]) => {
        setTransactions(txns);
        setIncome(inc);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, []);

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
            />
          )}
        </div>
      </div>

      {/* ─── Section 3: Income vs Expenditures ───────────────────── */}
      <div className="section">
        <div className="card">
          <div className="card-header">
            <h2>Income vs. Expenditures — {new Date().getFullYear()}</h2>
          </div>
          {monthlyBalance.length === 0 ? (
            <EmptyState message={`No data for ${new Date().getFullYear()} yet.`} />
          ) : (
            <>
              {/* Numeric table */}
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
                      <tr key={row.month}>
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

              {/* Bar chart */}
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={monthlyBalance} margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.8125rem' }}
                    formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  />
                  <Legend wrapperStyle={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }} />
                  <Bar dataKey="income" name="Income" fill="#4ade80" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expenses" name="Expenses" fill="#f87171" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="surplus" name="Surplus" radius={[3, 3, 0, 0]}>
                    {monthlyBalance.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.surplus >= 0 ? '#4ade80' : '#f87171'} fillOpacity={0.5} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
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
                                    background: CATEGORY_COLORS[row.category],
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
                                    background: CATEGORY_COLORS[row.category],
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
                        <Cell key={`cell-${index}`} fill={CATEGORY_COLORS[entry.category]} />
                      ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </div>
      </div>
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

interface ExpenseCategoryTableProps {
  monthlyTable: Array<{ category: Category; months: number[]; total: number }>;
  transactions: Transaction[];
  currentMonth: number;
  expandedCategory: Category | null;
  onSelect: (category: Category) => void;
}

function ExpenseCategoryTable({
  monthlyTable,
  transactions,
  currentMonth,
  expandedCategory,
  onSelect,
}: ExpenseCategoryTableProps) {
  const year = new Date().getFullYear();
  const visibleRows = expandedCategory
    ? monthlyTable.filter((r) => r.category === expandedCategory)
    : monthlyTable;

  // Individual transactions in the expanded category for the current year
  const categoryTransactions = expandedCategory
    ? transactions
        .filter((t) => {
          if (t.type !== 'expense') return false;
          if (t.category !== expandedCategory) return false;
          return parseISO(t.date).getFullYear() === year;
        })
        .sort((a, b) => (a.date < b.date ? 1 : -1))
    : [];

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
                          background: CATEGORY_COLORS[row.category],
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
          <h3 style={{ marginBottom: 12, color: 'var(--text-secondary)' }}>
            Transactions in {expandedCategory} — {year}
            <span className="text-xs text-muted" style={{ marginLeft: 8 }}>
              ({categoryTransactions.length} record{categoryTransactions.length !== 1 ? 's' : ''})
            </span>
          </h3>
          {categoryTransactions.length === 0 ? (
            <p className="text-muted text-sm">No transactions in this category for {year}.</p>
          ) : (
            <div className="preview-scroll" style={{ maxHeight: 420 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Description</th>
                    <th className="num">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryTransactions.map((t) => (
                    <tr key={t.id}>
                      <td className="text-sm font-mono" style={{ whiteSpace: 'nowrap' }}>{t.date}</td>
                      <td>{t.description}</td>
                      <td className="num text-danger">{formatCurrency(Math.abs(t.amount))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
