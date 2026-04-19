import { useState } from 'react';
import { Category, UserCategories } from '../../types';
import { TransactionUpdate, IncomeUpdate } from '../../api/client';
import { formatCurrency } from '../../utils/dataProcessing';
import { getCategoryColor } from '../../utils/categories';
import CategorySelect, { NEW_CATEGORY_SENTINEL } from '../CategorySelect';
import NotesCell from './NotesCell';

// ─── Unified drill-down event shape ────────────────────────────────────────

export interface DrillDownEvent {
  id: string;
  kind: 'expense' | 'income';
  date: string;
  description: string;
  category?: Category;  // only meaningful for expense
  amount: number;       // always positive; kind disambiguates direction
  notes?: string;       // only meaningful for expense
}

// ─── Edit draft ─────────────────────────────────────────────────────────────

interface EditDraft {
  id: string;
  kind: 'expense' | 'income';
  date: string;
  description: string;
  category: Category;
  amount: string;
}

// ─── Props ──────────────────────────────────────────────────────────────────

export interface TransactionDrillDownProps {
  events: DrillDownEvent[];
  onDeleteMany: (txnIds: string[], incIds: string[]) => Promise<void>;
  onDeleteOne: (event: DrillDownEvent) => Promise<void>;
  onUpdateTransaction: (id: string, updates: TransactionUpdate) => Promise<void>;
  onUpdateIncome?: (id: string, updates: IncomeUpdate) => Promise<void>;
  userCategories: UserCategories;
  addCustomCategory: (name: string) => string | null;
  emptyMessage?: string;
  isActiveOwner?: boolean;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function TransactionDrillDown({
  events,
  onDeleteMany,
  onDeleteOne,
  onUpdateTransaction,
  onUpdateIncome,
  userCategories,
  addCustomCategory,
  emptyMessage = 'No transactions found.',
  isActiveOwner = true,
}: TransactionDrillDownProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);

  type SortKey = 'date' | 'description' | 'category' | 'amount';
  type SortDir = 'asc' | 'desc';
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir(key === 'date' ? 'desc' : 'asc'); }
  }

  const sortedEvents = [...events].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1;
    switch (sortKey) {
      case 'date': return (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) * dir;
      case 'description':
        return a.description.localeCompare(b.description) * dir;
      case 'category':
        return (a.category ?? '').localeCompare(b.category ?? '') * dir;
      case 'amount': return (a.amount - b.amount) * dir;
    }
  });

  // Composite key: "expense:<id>" or "income:<id>" to avoid collisions
  const eventKey = (e: DrillDownEvent) => `${e.kind}:${e.id}`;

  function toggleOne(e: DrillDownEvent) {
    setSelectedIds((prev) => {
      const k = eventKey(e);
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function toggleAll() {
    setSelectedIds((prev) => {
      if (prev.size === sortedEvents.length) return new Set();
      return new Set(sortedEvents.map(eventKey));
    });
  }

  async function deleteSelected() {
    if (selectedIds.size === 0) return;
    if (!isActiveOwner) {
      window.alert("You can't delete data from a workspace that you don't own. Only the workspace owner can delete data.");
      return;
    }
    const n = selectedIds.size;
    if (!window.confirm(`Delete ${n} selected entr${n !== 1 ? 'ies' : 'y'}?`)) return;

    const txnIds: string[] = [];
    const incIds: string[] = [];
    for (const k of selectedIds) {
      const colonIdx = k.indexOf(':');
      const kind = k.slice(0, colonIdx);
      const id = k.slice(colonIdx + 1);
      if (kind === 'expense') txnIds.push(id);
      else if (kind === 'income') incIds.push(id);
    }

    setBusy(true);
    try {
      await onDeleteMany(txnIds, incIds);
      setSelectedIds(new Set());
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteOne(e: DrillDownEvent) {
    if (!isActiveOwner) {
      window.alert("You can't delete data from a workspace that you don't own. Only the workspace owner can delete data.");
      return;
    }
    if (!window.confirm(`Delete "${e.description}"?`)) return;
    setBusy(true);
    try {
      await onDeleteOne(e);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(e: DrillDownEvent) {
    setEditDraft({
      id: e.id,
      kind: e.kind,
      date: e.date,
      description: e.description,
      category: e.category ?? 'Other',
      amount: e.amount.toFixed(2),
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
      } else if (onUpdateIncome) {
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

  if (events.length === 0) {
    return <p className="text-muted text-sm">{emptyMessage}</p>;
  }

  return (
    <>
      {selectedIds.size > 0 && isActiveOwner && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            className="btn btn-sm btn-danger"
            onClick={deleteSelected}
            disabled={busy}
          >
            {busy ? <span className="spinner" /> : `Delete selected (${selectedIds.size})`}
          </button>
        </div>
      )}

      <div className="preview-scroll" style={{ maxHeight: 420 }}>
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === sortedEvents.length && sortedEvents.length > 0}
                  ref={(el) => {
                    if (el) {
                      el.indeterminate = selectedIds.size > 0 && selectedIds.size < sortedEvents.length;
                    }
                  }}
                  onChange={toggleAll}
                  title="Select all / none"
                />
              </th>
              <th onClick={() => toggleSort('date')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Date{sortKey === 'date' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th onClick={() => toggleSort('description')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Description{sortKey === 'description' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th style={{ width: 180 }}>Notes</th>
              <th onClick={() => toggleSort('category')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Category{sortKey === 'category' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th className="num" onClick={() => toggleSort('amount')} style={{ cursor: 'pointer', userSelect: 'none' }}>
                Amount{sortKey === 'amount' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
              </th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {sortedEvents.map((e) => {
              const k = eventKey(e);
              const isSelected = selectedIds.has(k);
              const isEditing = editDraft?.id === e.id && editDraft?.kind === e.kind;

              if (isEditing) {
                return (
                  <tr key={k} style={{ background: 'var(--accent-dim)' }}>
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
                      <input
                        type="text"
                        className="input"
                        style={{ padding: '4px 8px', fontSize: '0.8125rem' }}
                        value={editDraft.description}
                        onChange={(ev) => setEditDraft({ ...editDraft, description: ev.target.value })}
                      />
                    </td>
                    <td>{/* Notes edited independently via its own cell */}</td>
                    <td>
                      {editDraft.kind === 'expense' ? (
                        <CategorySelect
                          value={editDraft.category}
                          customCategories={userCategories.customCategories}
                          onChange={handleEditCategoryPick}
                          compact
                        />
                      ) : (
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
                      )}
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
                <tr key={k} style={isSelected ? { background: 'var(--accent-dim)' } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleOne(e)}
                    />
                  </td>
                  <td className="text-sm font-mono" style={{ whiteSpace: 'nowrap' }}>{e.date}</td>
                  <td>{e.description}</td>
                  {e.kind === 'expense' ? (
                    <td style={{ maxWidth: 180, verticalAlign: 'top', padding: 0 }}>
                      <NotesCell
                        value={e.notes ?? ''}
                        onCommit={(notes) => onUpdateTransaction(e.id, { notes })}
                      />
                    </td>
                  ) : (
                    <td></td>
                  )}
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
                      {e.kind === 'expense' && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => onUpdateTransaction(e.id, { archived: true })}
                          disabled={busy}
                          title="Archive"
                          style={{ padding: '4px 8px' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="21 8 21 21 3 21 3 8" />
                            <rect x="1" y="3" width="22" height="5" />
                            <line x1="10" y1="12" x2="14" y2="12" />
                          </svg>
                        </button>
                      )}
                      {isActiveOwner && (
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleDeleteOne(e)}
                          disabled={busy}
                          title="Delete"
                          style={{ padding: '4px 8px' }}
                        >
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
