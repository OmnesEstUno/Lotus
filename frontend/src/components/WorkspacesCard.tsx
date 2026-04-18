import { useState } from 'react';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useCurrentUser } from '../hooks/useCurrentUser';
import {
  createInstance,
  renameInstance,
  deleteInstance,
  addInstanceMember,
  removeInstanceMember,
} from '../api/client';

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

  async function handleAddMember(id: string) {
    const username = prompt('Username to add:');
    if (!username?.trim()) return;
    setBusy(true);
    setError('');
    try {
      await addInstanceMember(id, username.trim().toLowerCase());
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(id: string, username: string) {
    if (!confirm(`Remove ${username} from this workspace?`)) return;
    setBusy(true);
    setError('');
    try {
      await removeInstanceMember(id, username);
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
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {instances.map((inst) => {
            const isOwner = inst.owner === currentUser;
            return (
              <li
                key={inst.id}
                style={{ padding: '12px 0', borderBottom: '1px solid var(--border-subtle)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <strong style={{ color: 'var(--text-primary)' }}>{inst.name}</strong>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      color: isOwner ? 'var(--accent)' : 'var(--text-muted)',
                      background: isOwner ? 'var(--accent-dim)' : 'var(--bg-elevated)',
                      padding: '2px 8px',
                      borderRadius: 'var(--radius-sm)',
                    }}
                  >
                    {isOwner ? 'Owner' : 'Member'}
                  </span>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleRename(inst.id, inst.name)}
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                    >
                      Rename
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => handleDelete(inst.id, inst.name)}
                        className="btn btn-sm"
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
                </div>

                {isOwner && (
                  <div style={{ marginTop: 10, paddingLeft: 4 }}>
                    <p
                      style={{
                        margin: '0 0 6px',
                        fontSize: '0.8125rem',
                        color: 'var(--text-secondary)',
                        fontWeight: 500,
                      }}
                    >
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
                            padding: '3px 0',
                            fontSize: '0.875rem',
                          }}
                        >
                          <span style={{ color: 'var(--text-primary)' }}>
                            {u}
                            {u === inst.owner && (
                              <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                                (owner)
                              </span>
                            )}
                          </span>
                          {u !== inst.owner && (
                            <button
                              onClick={() => handleRemoveMember(inst.id, u)}
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              style={{ fontSize: '0.75rem', padding: '2px 8px' }}
                            >
                              Remove
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => handleAddMember(inst.id)}
                      className="btn btn-ghost btn-sm"
                      disabled={busy}
                    >
                      + Add user
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
