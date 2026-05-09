import { useEffect, useState } from 'react';
import CollapsibleCard from './CollapsibleCard';
import {
  createAdminResetToken,
  listAdminResetTokens,
  deleteAdminResetToken,
  type AdminResetTokenSummary,
} from '../api/auth';
import { UNIX_MS_MULTIPLIER } from '../utils/constants';
import { dialog } from '../utils/dialog';

function buildLink(token: string): string {
  return `${window.location.origin}${window.location.pathname}#/reset?token=${encodeURIComponent(token)}`;
}

function ChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}
function ChevronRight() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function PasswordResetTokensCard() {
  const [tokens, setTokens] = useState<AdminResetTokenSummary[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [usernameInput, setUsernameInput] = useState('');

  async function refresh(autoExpandId?: string) {
    try {
      const r = await listAdminResetTokens();
      const sorted = r.tokens.sort((a, b) => b.createdAt - a.createdAt);
      setTokens(sorted);
      if (autoExpandId) setExpandedId(autoExpandId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleGenerate() {
    const target = usernameInput.trim().toLowerCase();
    if (!target) {
      setError('Enter a username first.');
      return;
    }
    setLoading(true); setError('');
    try {
      const created = await createAdminResetToken(target);
      setUsernameInput('');
      await refresh(created.id);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!await dialog.confirm('Revoke this reset link?')) return;
    try {
      await deleteAdminResetToken(id);
      if (expandedId === id) setExpandedId(null);
      await refresh();
    } catch (err) { setError((err as Error).message); }
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <CollapsibleCard title="Password reset links">
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', marginTop: 0 }}>
        Generate a one-time link a user can paste into their browser to set a new password.
        Links expire after 24 hours and can only be used once.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 16 }}>
        <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
          <label className="form-label" htmlFor="pwreset-username">Username to reset</label>
          <input
            id="pwreset-username"
            name="username"
            type="text"
            className="input"
            value={usernameInput}
            onChange={(e) => setUsernameInput(e.target.value)}
            placeholder="e.g. alice"
            autoComplete="off"
            style={{ width: '100%' }}
          />
        </div>
        <button onClick={handleGenerate} disabled={loading} className="btn btn-primary">
          {loading ? 'Generating…' : 'Generate link'}
        </button>
      </div>

      {error && <p style={{ color: 'var(--danger)', fontSize: '0.8125rem' }}>{error}</p>}

      <h3 style={{ marginTop: 0, marginBottom: 8 }}>Active reset links</h3>
      {tokens.length === 0 && <p style={{ color: 'var(--text-muted)' }}>No active reset links.</p>}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {tokens.map((t) => {
          const isExpanded = expandedId === t.id;
          const link = buildLink(t.token);

          return (
            <li key={t.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <button
                type="button"
                onClick={() => toggleExpand(t.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  width: '100%',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '10px 0',
                  textAlign: 'left',
                  color: 'var(--text-primary)',
                }}
              >
                <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </span>
                <span style={{ fontWeight: 500 }}>{t.username}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: '0.8125rem', flex: 1 }}>
                  expires {new Date(t.expiresAt * UNIX_MS_MULTIPLIER).toLocaleString()}
                </span>
                {t.usedBy && (
                  <span style={{ color: 'var(--success)', fontSize: '0.8125rem', flexShrink: 0 }}>
                    used
                  </span>
                )}
              </button>

              {isExpanded && (
                <div style={{ paddingBottom: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      background: 'var(--bg-elevated)',
                      borderRadius: 8,
                      padding: '10px 14px',
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      wordBreak: 'break-all',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    {link}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => navigator.clipboard.writeText(link)}
                    >
                      Copy link
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      onClick={() => handleRevoke(t.id)}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </CollapsibleCard>
  );
}
