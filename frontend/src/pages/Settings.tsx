import { useEffect, useState } from 'react';
import { getTransactions, renameCategory, deleteCategory } from '../api/client';
import { Transaction, UserCategories } from '../types';
import { useUserCategories } from '../hooks/useUserCategories';
import { getCategoryColor } from '../utils/categories';
import { useCurrentUser } from '../hooks/useCurrentUser';
import InviteTokensCard from '../components/InviteTokensCard';
import Layout from '../components/layout/Layout';

/**
 * Settings page — currently hosts management of user-created custom
 * categories and the pattern→category mappings.
 */
export default function Settings() {
  const { userCategories, setUserCategories } = useUserCategories();
  const currentUser = useCurrentUser();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    getTransactions()
      .then(setTransactions)
      .catch((err) => setStatus({ kind: 'error', text: (err as Error).message }))
      .finally(() => setLoading(false));
  }, []);

  // Count of transactions per category — shown next to each custom category
  const categoryCounts = new Map<string, number>();
  for (const t of transactions) {
    if (t.type === 'expense') {
      categoryCounts.set(t.category, (categoryCounts.get(t.category) ?? 0) + 1);
    }
  }

  async function refreshTransactions() {
    try {
      const txns = await getTransactions();
      setTransactions(txns);
    } catch {
      /* non-fatal */
    }
  }

  async function handleRename(from: string) {
    const newName = window.prompt(`Rename "${from}" to:`, from)?.trim();
    if (!newName || newName === from) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await renameCategory(from, newName);
      setStatus({
        kind: 'success',
        text: `Renamed "${from}" → "${newName}" (updated ${result.updated} transaction${result.updated !== 1 ? 's' : ''} and ${result.mappingsUpdated} mapping${result.mappingsUpdated !== 1 ? 's' : ''}).`,
      });
      // Optimistically update local custom-category list
      setUserCategories((prev) => {
        const nextCustom = prev.customCategories.map((c) => (c === from ? newName : c));
        // De-dup case where `newName` already exists
        const unique = [...new Set(nextCustom)];
        return {
          customCategories: unique,
          mappings: prev.mappings.map((m) => (m.category === from ? { ...m, category: newName } : m)),
        };
      });
      await refreshTransactions();
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(name: string) {
    const count = categoryCounts.get(name) ?? 0;
    const msg =
      count > 0
        ? `Delete "${name}"? ${count} transaction${count !== 1 ? 's' : ''} will be reassigned to "Other".`
        : `Delete "${name}"? This category has no transactions.`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await deleteCategory(name, 'Other');
      setStatus({
        kind: 'success',
        text: `Deleted "${name}" (reassigned ${result.reassigned} transaction${result.reassigned !== 1 ? 's' : ''}, removed ${result.mappingsRemoved} mapping${result.mappingsRemoved !== 1 ? 's' : ''}).`,
      });
      // Optimistic local update
      setUserCategories((prev) => ({
        customCategories: prev.customCategories.filter((c) => c !== name),
        mappings: prev.mappings.filter((m) => m.category !== name),
      }));
      await refreshTransactions();
    } catch (err) {
      setStatus({ kind: 'error', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  function handleDeleteMapping(pattern: string) {
    if (!window.confirm(`Delete the mapping for "${pattern}"?`)) return;
    setUserCategories((prev) => ({
      ...prev,
      mappings: prev.mappings.filter((m) => m.pattern !== pattern),
    }));
    setStatus({ kind: 'success', text: `Mapping for "${pattern}" removed.` });
  }

  function handleEditMapping(pattern: string, currentCategory: string) {
    const newCategory = window.prompt(
      `Change the category for pattern "${pattern}" to:`,
      currentCategory,
    )?.trim();
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

      {/* ─── Admin: Invite Tokens ─────────────────────────── */}
      {currentUser === 'admin' && <InviteTokensCard />}

      {/* ─── Custom Categories ────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div className="card-header">
          <h2>Custom Categories</h2>
          <span className="text-xs text-muted">
            {userCategories.customCategories.length} custom
          </span>
        </div>

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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Mappings ─────────────────────────────────────── */}
      <div className="card">
        <div className="card-header">
          <h2>Description Mappings</h2>
          <span className="text-xs text-muted">
            {userCategories.mappings.length} rule{userCategories.mappings.length !== 1 ? 's' : ''}
          </span>
        </div>

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
      </div>
    </Layout>
  );
}

// Re-export for use elsewhere if needed
export type { UserCategories };
