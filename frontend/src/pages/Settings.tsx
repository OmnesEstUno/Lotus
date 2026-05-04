import { useEffect, useState } from 'react';
import { getTransactions } from '../api/transactions';
import { getIncome } from '../api/income';
import { getUserCategories, renameCategory, deleteCategory } from '../api/categories';
import { runMutation } from '../utils/mutation';
import { dialog } from '../utils/dialog';
import { IncomeEntry, Transaction } from '../types';
import { useUserCategories } from '../hooks/useUserCategories';
import { getCategoryColor } from '../utils/categorization/colors';
import { useColorBlindMode } from '../hooks/useColorBlindMode';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useDashboardLayout, CARD_LABELS, CardId } from '../hooks/useDashboardLayout';
import {
  DndContext,
  closestCenter,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { useSortableListReorder } from '../hooks/useSortableListReorder';
import { CSS } from '@dnd-kit/utilities';
import CollapsibleCard from '../components/CollapsibleCard';
import InviteTokensCard from '../components/InviteTokensCard';
import ToggleSwitch from '../components/ToggleSwitch';
import WorkspacesCard from '../components/WorkspacesCard';
import AccessibilityCard from '../components/AccessibilityCard';
import SecurityCard from '../components/SecurityCard';
import ArchivedCard from '../components/dashboard/ArchivedCard';
import DangerZone from '../components/DangerZone';
import FeatureRequestCard from '../components/FeatureRequestCard';
import FeatureRequestsAdminCard from '../components/FeatureRequestsAdminCard';
import Layout from '../components/layout/Layout';

interface CardVisibilityRowProps {
  id: CardId;
  label: string;
  checked: boolean;
  onToggle: () => void;
}

function CardVisibilityRow({ id, label, checked, onToggle }: CardVisibilityRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '6px 0',
  };
  return (
    <div ref={setNodeRef} style={style}>
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        type="button"
        aria-label={`Drag to reorder ${label}`}
        className="dashboard-card-handle"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 28,
          height: 28,
          background: 'transparent',
          border: 'none',
          color: 'var(--text-muted)',
          cursor: isDragging ? 'grabbing' : 'grab',
          borderRadius: 6,
          touchAction: 'none',
          flexShrink: 0,
        }}
      >
        <span className="material-symbols-outlined" style={{ fontSize: 18 }}>drag_indicator</span>
      </button>
      <span style={{ flex: 1 }}>{label}</span>
      <ToggleSwitch
        checked={checked}
        onChange={onToggle}
        ariaLabel={`${checked ? 'Hide' : 'Show'} ${label} on dashboard`}
      />
    </div>
  );
}

/**
 * Settings page — currently hosts management of user-created custom
 * categories and the pattern→category mappings.
 */
export default function Settings() {
  const { userCategories, setUserCategories, saveError } = useUserCategories();
  useColorBlindMode();
  const currentUser = useCurrentUser();
  const { isActiveOwner, activeInstanceId } = useWorkspaces();
  const { cardOrder, setCardOrder, hidden, toggleHidden } = useDashboardLayout(activeInstanceId);
  const { sensors, onDragEnd: handleCardOrderDragEnd } = useSortableListReorder(cardOrder, setCardOrder);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [income, setIncome] = useState<IncomeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    // Gate on active instance: GET /api/transactions and /api/income require
    // X-Instance-Id, which isn't set until useWorkspaces resolves the active id.
    if (!activeInstanceId) return;
    Promise.all([getTransactions(), getIncome()])
      .then(([txns, inc]) => { setTransactions(txns); setIncome(inc); })
      .catch((err) => setStatus({ kind: 'error', text: (err as Error).message }))
      .finally(() => setLoading(false));
  }, [activeInstanceId]);

  // Count of transactions per category — shown next to each custom category
  const categoryCounts = new Map<string, number>();
  for (const t of transactions) {
    if (t.type === 'expense') {
      categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1);
    }
  }

  async function refreshTransactions() {
    try {
      const [txns, inc] = await Promise.all([getTransactions(), getIncome()]);
      setTransactions(txns);
      setIncome(inc);
    } catch (err) {
      console.error('Failed to refresh transactions/income in Settings', err);
      setStatus({ kind: 'error', text: 'Could not refresh data — some figures may be stale.' });
    }
  }

  async function handleRename(from: string) {
    const newName = (await dialog.prompt(`Rename "${from}" to:`, from))?.trim();
    if (!newName || newName === from) return;
    await runMutation({
      onStart: () => { setBusy(true); setStatus(null); },
      call: () => renameCategory(from, newName),
      onSuccess: async (result) => {
        // Update local state AFTER the API call succeeds to avoid racing the
        // useUserCategories auto-save hook with the explicit mutation.
        setUserCategories((prev) => {
          const nextCustom = prev.customCategories.map((c) => (c === from ? newName : c));
          // De-dup case where `newName` already exists
          const unique = [...new Set(nextCustom)];
          return {
            customCategories: unique,
            mappings: prev.mappings.map((m) => (m.category === from ? { ...m, category: newName } : m)),
          };
        });
        await Promise.all([refreshTransactions(), getUserCategories()]).catch(() => undefined);
        setStatus({
          kind: 'success',
          text: `Renamed "${from}" → "${newName}" (updated ${result.updated} transaction${result.updated !== 1 ? 's' : ''} and ${result.mappingsUpdated} mapping${result.mappingsUpdated !== 1 ? 's' : ''}).`,
        });
      },
      onConflict: async (msg) => {
        await Promise.all([refreshTransactions(), getUserCategories()]).catch(() => undefined);
        setStatus({ kind: 'error', text: msg });
      },
      onError: (msg) => setStatus({ kind: 'error', text: msg }),
      onFinally: () => setBusy(false),
      conflictMessage: 'Data was changed by another tab — please retry the rename.',
    });
  }

  async function handleDelete(name: string) {
    if (!isActiveOwner) {
      await dialog.alert("You can't delete data from a workspace that you don't own. Only the workspace owner can delete data.");
      return;
    }
    const count = categoryCounts.get(name) ?? 0;
    const msg =
      count > 0
        ? `Delete "${name}"? ${count} transaction${count !== 1 ? 's' : ''} will be reassigned to "Other".`
        : `Delete "${name}"? This category has no transactions.`;
    if (!await dialog.confirm(msg)) return;
    await runMutation({
      onStart: () => { setBusy(true); setStatus(null); },
      call: () => deleteCategory(name, 'Other'),
      onSuccess: async (result) => {
        // Update local state AFTER the API call succeeds to avoid racing the
        // useUserCategories auto-save hook with the explicit mutation.
        setUserCategories((prev) => ({
          customCategories: prev.customCategories.filter((c) => c !== name),
          mappings: prev.mappings.filter((m) => m.category !== name),
        }));
        await Promise.all([refreshTransactions(), getUserCategories()]).catch(() => undefined);
        setStatus({
          kind: 'success',
          text: `Deleted "${name}" (reassigned ${result.reassigned} transaction${result.reassigned !== 1 ? 's' : ''}, removed ${result.mappingsRemoved} mapping${result.mappingsRemoved !== 1 ? 's' : ''}).`,
        });
      },
      onConflict: async (msg) => {
        await Promise.all([refreshTransactions(), getUserCategories()]).catch(() => undefined);
        setStatus({ kind: 'error', text: msg });
      },
      onError: (errMsg) => setStatus({ kind: 'error', text: errMsg }),
      onFinally: () => setBusy(false),
      conflictMessage: 'Data was changed by another tab — please retry the deletion.',
    });
  }

  async function handleDeleteMapping(pattern: string) {
    if (!await dialog.confirm(`Delete the mapping for "${pattern}"?`)) return;
    setUserCategories((prev) => ({
      ...prev,
      mappings: prev.mappings.filter((m) => m.pattern !== pattern),
    }));
    setStatus({ kind: 'success', text: `Mapping for "${pattern}" removed.` });
  }

  async function handleEditMapping(pattern: string, currentCategory: string) {
    const newCategory = (await dialog.prompt(
      `Change the category for pattern "${pattern}" to:`,
      currentCategory,
    ))?.trim();
    if (!newCategory || newCategory === currentCategory) return;
    setUserCategories((prev) => ({
      ...prev,
      mappings: prev.mappings.map((m) => (m.pattern === pattern ? { ...m, category: newCategory } : m)),
    }));
    setStatus({ kind: 'success', text: `Mapping for "${pattern}" updated.` });
  }

  if (loading) {
    return (
      <Layout>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 }}>
          <div className="spinner" />
          <span style={{ color: 'var(--text-muted)' }}>Loading settings…</span>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: '1.5rem', marginBottom: 4 }}>Settings</h1>
        <p style={{ color: 'var(--text-muted)' }}>
          Manage your custom categories and description-to-category mappings.
        </p>
      </div>

      {status && (
        <div
          className={`alert ${status.kind === 'success' ? 'alert-success' : 'alert-danger'}`}
          style={{ marginBottom: 20 }}
        >
          {status.text}
        </div>
      )}
      {saveError && (
        <div className="alert alert-danger" style={{ marginBottom: 20 }}>
          {saveError}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* ─── Admin: Invite Tokens ─────────────────────────── */}
      {currentUser === 'admin' && <InviteTokensCard />}

      {/* ─── Workspaces ───────────────────────────────────── */}
      <WorkspacesCard />

      {/* ─── Dashboard Card Visibility ────────────────────── */}
      <CollapsibleCard
        title="Dashboard Card Visibility"
        headerExtra={<span className="text-xs text-muted">{cardOrder.length - hidden.size} visible</span>}
      >
        <p className="text-xs text-muted" style={{ marginBottom: 12 }}>
          Drag rows to change the order on your dashboard. Toggle off to hide a card.
        </p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleCardOrderDragEnd}
        >
          <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {cardOrder.map((id) => (
                <CardVisibilityRow
                  key={id}
                  id={id}
                  label={CARD_LABELS[id]}
                  checked={!hidden.has(id)}
                  onToggle={() => toggleHidden(id)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </CollapsibleCard>

      {/* ─── Custom Categories ────────────────────────────── */}
      <CollapsibleCard
        title="Custom Categories"
        headerExtra={<span className="text-xs text-muted">{userCategories.customCategories.length} custom</span>}
      >
        {userCategories.customCategories.length === 0 ? (
          <p className="text-muted text-sm">
            You haven't created any custom categories yet. Create one from the Data Entry page
            or the Dashboard edit flow.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Transactions</th>
                  <th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {userCategories.customCategories.map((name) => (
                  <tr key={name}>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: getCategoryColor(name),
                            flexShrink: 0,
                          }}
                        />
                        {name}
                      </span>
                    </td>
                    <td className="num">{categoryCounts.get(name) ?? 0}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleRename(name)}
                          disabled={busy}
                        >
                          Rename
                        </button>
                        {isActiveOwner && (
                          <button
                            className="btn btn-sm"
                            onClick={() => handleDelete(name)}
                            disabled={busy}
                            style={{
                              background: 'var(--danger-bg)',
                              color: 'var(--danger)',
                              border: '1px solid rgba(248,113,113,0.3)',
                            }}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      {/* ─── Description Mappings ────────────────────────── */}
      <CollapsibleCard
        title="Description Mappings"
        headerExtra={<span className="text-xs text-muted">{userCategories.mappings.length} rule{userCategories.mappings.length !== 1 ? 's' : ''}</span>}
      >
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 16 }}>
          When a transaction description contains one of these patterns, it's automatically
          assigned the matching category on import. Patterns are created when you assign a custom
          category to a row in the CSV upload preview.
        </p>

        {userCategories.mappings.length === 0 ? (
          <p className="text-muted text-sm">
            No mappings yet. Assign a custom category to a row in the Data Entry preview to
            create one automatically.
          </p>
        ) : (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Pattern (contains)</th>
                  <th>Category</th>
                  <th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {userCategories.mappings.map((m) => (
                  <tr key={m.pattern}>
                    <td className="font-mono text-sm">{m.pattern}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            background: getCategoryColor(m.category),
                            flexShrink: 0,
                          }}
                        />
                        {m.category}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={() => handleEditMapping(m.pattern, m.category)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => handleDeleteMapping(m.pattern)}
                          style={{
                            background: 'var(--danger-bg)',
                            color: 'var(--danger)',
                            border: '1px solid rgba(248,113,113,0.3)',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleCard>

      {/* ─── Feature Request ──────────────────────────────── */}
      <FeatureRequestCard />
      {currentUser === 'admin' && <FeatureRequestsAdminCard />}

      {/* ─── Archived Transactions ────────────────────────── */}
      <ArchivedCard />

      {/* ─── Security ─────────────────────────────────────── */}
      <SecurityCard />

      {/* ─── Accessibility ────────────────────────────────── */}
      <AccessibilityCard />

      {/* ─── Danger Zone ──────────────────────────────────── */}
      <DangerZone
        transactions={transactions}
        income={income}
        userCategories={userCategories}
        onPurged={refreshTransactions}
        isActiveOwner={isActiveOwner}
      />

      </div>{/* end flex column */}
    </Layout>
  );
}

