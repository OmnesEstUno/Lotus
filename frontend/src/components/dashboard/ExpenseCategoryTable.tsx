import { useState, useEffect, useRef } from 'react';
import { parseISO, subMonths } from 'date-fns';
import { Transaction, Category, UserCategories } from '../../types';
import { updateTransaction } from '../../api/client';
import { formatCurrency, MONTH_NAMES } from '../../utils/dataProcessing';
import { getCategoryColor } from '../../utils/categories';
import CategorySelect, { NEW_CATEGORY_SENTINEL } from '../CategorySelect';
import { DrillDownRange, DRILL_DOWN_RANGE_LABELS } from './constants';

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
  el.style.height = `${el.scrollHeight + lineHeight * 2}px`;
}

// ─── Expandable Expense Category Table ─────────────────────────────────────

interface ExpenseEditDraft {
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

export default function ExpenseCategoryTable({
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
  const [editDraft, setEditDraft] = useState<ExpenseEditDraft | null>(null);
  // Per-row notes draft: keyed by transaction id, populated on focus, committed on blur.
  const [notesDraft, setNotesDraft] = useState<Record<string, string>>({});
  // Track which note cell is currently focused (for the dual-element display).
  const [focusedNoteId, setFocusedNoteId] = useState<string | null>(null);
  const notesTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // After the textarea mounts (focusedNoteId changes), resize it to fit initial content.
  useEffect(() => {
    if (focusedNoteId && notesTextareaRef.current) {
      autoResize(notesTextareaRef.current);
      notesTextareaRef.current.focus();
    }
  }, [focusedNoteId]);

  useEffect(() => {
    setSelectedIds(new Set());
    setSearchQuery('');
    setEditDraft(null);
    setNotesDraft({});
    setFocusedNoteId(null);
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
                    <th style={{ width: 180 }}>Notes</th>
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
                          <td>{/* Notes edited independently via its own cell */}</td>
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

                    const isFocused = focusedNoteId === t.id;
                    const currentNote = notesDraft[t.id] ?? t.notes ?? '';

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
                        <td style={{ maxWidth: 180, verticalAlign: 'top', padding: 0 }}>
                          {isFocused ? (
                            <textarea
                              ref={notesTextareaRef}
                              className="notes-field notes-focused"
                              value={currentNote}
                              onChange={(e) =>
                                setNotesDraft((prev) => ({ ...prev, [t.id]: e.target.value }))
                              }
                              onInput={(e) => autoResize(e.currentTarget)}
                              onBlur={(e) => {
                                e.currentTarget.style.height = '';
                                setFocusedNoteId(null);
                                const next = e.currentTarget.value;
                                const prev = t.notes ?? '';
                                if (next !== prev) {
                                  onUpdateTransaction(t.id, { notes: next });
                                }
                              }}
                              autoFocus
                            />
                          ) : (
                            <div
                              className="notes-field notes-idle"
                              title={currentNote || 'Click to add a note…'}
                              onClick={() => {
                                setNotesDraft((prev) => ({
                                  ...prev,
                                  [t.id]: t.notes ?? '',
                                }));
                                setFocusedNoteId(t.id);
                              }}
                            >
                              {currentNote || <span className="notes-placeholder">Add a note…</span>}
                            </div>
                          )}
                        </td>
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
