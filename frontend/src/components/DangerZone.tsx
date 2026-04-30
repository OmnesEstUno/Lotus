import { useState } from 'react';
import { Transaction, IncomeEntry, UserCategories } from '../types';
import { purgeAllData } from '../api/transactions';
import { dialog } from '../utils/dialog';
import { downloadJSON } from '../utils/download';

interface DangerZoneProps {
  transactions: Transaction[];
  income: IncomeEntry[];
  userCategories: UserCategories;
  onPurged: () => Promise<void>;
  isActiveOwner?: boolean;
}

export default function DangerZone({ transactions, income, userCategories, onPurged, isActiveOwner = true }: DangerZoneProps) {
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
    if (!isActiveOwner) {
      await dialog.alert("You can't delete data from a workspace that you don't own. Only the workspace owner can delete data.");
      return;
    }
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
    downloadJSON(`lotus-backup-${new Date().toISOString().slice(0, 10)}.json`, payload);
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

      {/* Purge (destructive) — owner only */}
      {isActiveOwner && (
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
      )}
    </div>
  );
}
