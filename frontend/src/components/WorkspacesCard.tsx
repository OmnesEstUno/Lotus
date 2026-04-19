import { useEffect, useState } from 'react';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useCurrentUser } from '../hooks/useCurrentUser';
import {
  createInstance,
  renameInstance,
  deleteInstance,
  removeInstanceMember,
  createWorkspaceInvite,
  listWorkspaceInvites,
  deleteWorkspaceInvite,
  WorkspaceInviteSummary,
} from '../api/client';

function WorkspaceInvitesPanel({ instanceId }: { instanceId: string }) {
  const [invites, setInvites] = useState<WorkspaceInviteSummary[]>([]);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [newInviteId, setNewInviteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function fetchInvites() {
    try {
      const r = await listWorkspaceInvites(instanceId);
      setInvites(r.invites.sort((a, b) => b.createdAt - a.createdAt));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => { fetchInvites(); }, [instanceId]);

  async function handleGenerate() {
    setLoading(true); setError('');
    try {
      const created = await createWorkspaceInvite(instanceId);
      const link = `${window.location.origin}${window.location.pathname}#/workspace-invite?token=${encodeURIComponent(created.token)}`;
      setNewLink(link);
      setNewInviteId(created.id);
      await fetchInvites();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    if (!confirm('Revoke this invite link?')) return;
    try {
      await deleteWorkspaceInvite(instanceId, inviteId);
      if (newInviteId === inviteId) { setNewLink(null); setNewInviteId(null); }
      await fetchInvites();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div style={{ marginTop: 10, paddingLeft: 4 }}>
      <p style={{ margin: '0 0 8px', fontSize: '0.8125rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
        Invite Members
      </p>
      {error && <p style={{ color: 'var(--danger)', fontSize: '0.8125rem', marginBottom: 6 }}>{error}</p>}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={handleGenerate}
        disabled={loading}
      >
        {loading ? 'Generating…' : 'Generate invite link'}
      </button>

      {newLink && (
        <div style={{ marginTop: 10, background: 'var(--bg-surface)', borderRadius: 'var(--radius-md)', padding: '10px 12px' }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>Share this link (7 days):</p>
          <div style={{ fontFamily: 'monospace', fontSize: '0.75rem', wordBreak: 'break-all', color: 'var(--accent)', marginBottom: 8 }}>
            {newLink}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigator.clipboard.writeText(newLink)}
          >
            Copy link
          </button>
        </div>
      )}

      {invites.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0 0 4px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active invites
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {invites.map((inv) => (
              <li key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', fontSize: '0.8125rem' }}>
                <span style={{ fontFamily: 'monospace', color: 'var(--text-muted)' }}>{inv.id.slice(0, 8)}…</span>
                <span style={{ color: 'var(--text-muted)', flex: 1 }}>
                  expires {new Date(inv.expiresAt * 1000).toLocaleDateString()}
                </span>
                {inv.usedBy
                  ? <span style={{ color: 'var(--success)', flexShrink: 0 }}>claimed by {inv.usedBy}</span>
                  : <button type="button" className="btn btn-danger btn-sm" style={{ fontSize: '0.75rem', padding: '2px 8px' }} onClick={() => handleRevoke(inv.id)}>Revoke</button>
                }
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function WorkspacesCard() {
  const { instances, refresh } = useWorkspaces();
  const currentUser = useCurrentUser();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    const name = prompt('Workspace name:');
    if (!name?.trim()) return;
    setBusy(true);
    setError('');
    try {
      await createInstance(name.trim());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string, current: string) {
    const next = prompt('New name:', current);
    if (!next?.trim() || next.trim() === current) return;
    setBusy(true);
    setError('');
    try {
      await renameInstance(id, next.trim());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Delete workspace "${name}" and all its data? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    try {
      await deleteInstance(id);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave(id: string, name: string) {
    if (!currentUser) return;
    if (!confirm(`Leave workspace "${name}"?`)) return;
    setBusy(true);
    setError('');
    try {
      await removeInstanceMember(id, currentUser);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(id: string, memberUsername: string) {
    if (!confirm(`Remove ${memberUsername} from this workspace?`)) return;
    setBusy(true);
    setError('');
    try {
      await removeInstanceMember(id, memberUsername);
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <div className="card-header">
        <h2>Workspaces</h2>
        <button onClick={handleCreate} disabled={busy} className="btn btn-primary btn-sm">
          Create new workspace
        </button>
      </div>

      {error && (
        <p style={{ color: 'var(--danger)', marginBottom: 12, fontSize: '0.875rem' }}>{error}</p>
      )}

      {instances.length === 0 ? (
        <p className="text-muted text-sm">
          No workspaces yet. Create one above to start tracking your finances.
        </p>
      ) : (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
          gap: 16,
        }}>
          {instances.map((inst) => {
            const isOwner = inst.owner === currentUser;
            return (
              <div key={inst.id} className="workspace-tile">
                {/* Left: workspace info */}
                <div className="workspace-tile-body">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ color: 'var(--text-primary)' }}>{inst.name}</strong>
                    <span
                      style={{
                        fontSize: '0.8rem',
                        color: isOwner ? 'var(--accent)' : 'var(--text-muted)',
                        background: isOwner ? 'var(--accent-dim)' : 'var(--bg-card)',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      {isOwner ? 'Owner' : 'Member'}
                    </span>
                  </div>

                  {/* Members list — shown to everyone, remove action is owner-only */}
                  <div style={{ marginTop: 8 }}>
                    <p style={{ margin: '0 0 4px', fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Members
                    </p>
                    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 8px' }}>
                      {inst.members.map((u) => (
                        <li
                          key={u}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '2px 0',
                            fontSize: '0.8125rem',
                          }}
                        >
                          <span style={{ color: 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {u}
                            {u === inst.owner && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>(owner)</span>
                            )}
                          </span>
                          {isOwner && u !== inst.owner && (
                            <button
                              onClick={() => handleRemoveMember(inst.id, u)}
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              style={{ fontSize: '0.75rem', padding: '2px 8px', flexShrink: 0 }}
                            >
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    {/* Invite section is owner-only */}
                    {isOwner && <WorkspaceInvitesPanel instanceId={inst.id} />}
                  </div>
                </div>

                {/* Right: vertically stacked action buttons */}
                <div className="workspace-tile-actions">
                  {isOwner && (
                    <button
                      onClick={() => handleRename(inst.id, inst.name)}
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                    >
                      Rename
                    </button>
                  )}
                  {isOwner ? (
                    <button
                      onClick={() => handleDelete(inst.id, inst.name)}
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      onClick={() => handleLeave(inst.id, inst.name)}
                      className="btn btn-danger btn-sm"
                      disabled={busy}
                    >
                      Leave
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
